import { useEffect, useRef, useState } from "react";
import { loadCfg, saveCfg, push, fetchRemote, applyEnvelope, snapshot, isReady } from "./lib/cloud.js";

// Cloud backup box (Neon). `rev` should change whenever the app state changes (used for auto-backup).
export default function CloudPanel({ appId, keys, rev }) {
  const [cfg, setCfg] = useState(() => loadCfg(appId));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef("");      // last snapshot known to be in the cloud
  const blocked = useRef(false); // cloud has a newer backup than this device has seen
  const timer = useRef(0);
  const ready = isReady(cfg);
  const update = (p) => setCfg((o) => { const n = { ...o, ...p }; saveCfg(appId, n); return n; });

  // on load: don't let auto-backup overwrite a newer backup made elsewhere
  useEffect(() => {
    if (!cfg.auto || !ready) return;
    let dead = false;
    fetchRemote(cfg, appId).then((env) => {
      if (dead || !env) return;
      if ((env.ts || 0) > (cfg.lastSync || 0)) { blocked.current = true; setStatus(`Cloud has a newer backup (${new Date(env.ts).toLocaleString()}) - Restore it, or Backup now to overwrite. Auto-backup paused.`); }
      else last.current = JSON.stringify(snapshot(keys));
    }).catch((e) => !dead && setStatus("Cloud check failed: " + e.message));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.auto, cfg.url, cfg.key]);

  // debounced auto-backup
  useEffect(() => {
    if (!cfg.auto || !ready || blocked.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (JSON.stringify(snapshot(keys)) === last.current) return;
      try { const r = await push(cfg, appId, keys); last.current = r.snap; update({ lastSync: r.ts }); setStatus(`Backed up ${new Date(r.ts).toLocaleTimeString()} (${Math.round(r.size / 1024)} KB)`); }
      catch (e) { setStatus("Auto-backup failed: " + e.message); }
    }, 8000);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, cfg.auto, cfg.url, cfg.key]);

  const run = (fn) => async () => { setBusy(true); try { await fn(); } catch (e) { setStatus("Failed: " + e.message); } setBusy(false); };

  const backup = run(async () => {
    if (blocked.current && !window.confirm("The cloud has a NEWER backup. Overwrite it with this device?")) return;
    const r = await push(cfg, appId, keys);
    blocked.current = false; last.current = r.snap; update({ lastSync: r.ts });
    setStatus(`Backed up ${new Date(r.ts).toLocaleTimeString()} (${Math.round(r.size / 1024)} KB)`);
  });
  const restore = run(async () => {
    if (!window.confirm("Replace the items/settings on this device with the cloud backup?")) return;
    const env = await fetchRemote(cfg, appId);
    if (!env) throw new Error("No backup found in the cloud yet");
    applyEnvelope(env, keys);
    saveCfg(appId, { ...cfg, lastSync: env.ts || Date.now() });
    setStatus("Restored - reloading...");
    setTimeout(() => window.location.reload(), 600);
  });

  return (
    <details className="box">
      <summary>☁ Cloud backup (Supabase)</summary>
      <input autoComplete="off" spellCheck={false} value={cfg.url || ""} onChange={(e) => update({ url: e.target.value.trim() })}
        placeholder="Supabase project URL (https://xxxx.supabase.co)" />
      <input type="password" autoComplete="off" spellCheck={false} value={cfg.key || ""} onChange={(e) => update({ key: e.target.value.trim() })}
        placeholder="Supabase anon (public) key" />
      <label className="chkrow"><input type="checkbox" checked={!!cfg.auto} onChange={(e) => update({ auto: e.target.checked })} /><span>Auto-backup after changes</span></label>
      <div className="row">
        <button className="go" disabled={!ready || busy} onClick={backup}>⬆ Backup now</button>
        <button disabled={!ready || busy} onClick={restore}>⬇ Restore</button>
      </div>
      <small>{status || (ready ? "Ready." : "Paste your project URL + anon key, then Backup now.")}</small>
    </details>
  );
}
