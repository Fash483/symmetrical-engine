// Cloud backup to Supabase (PostgREST). One row per (app, k) in table grab_backup;
// payload is a JSON envelope {v, ts, data}. cfg = { url, key }.

const cfgKey = (appId) => `grabcloud_cfg_${appId}`;
export const loadCfg = (appId) => { try { return JSON.parse(localStorage.getItem(cfgKey(appId))) || {}; } catch { return {}; } };
export const saveCfg = (appId, c) => { try { localStorage.setItem(cfgKey(appId), JSON.stringify(c)); } catch { /* ignore */ } };
export const isReady = (cfg) => !!(cfg && cfg.url && cfg.key);

async function req(cfg, method, path, body, extra) {
  const base = cfg.url.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  let r;
  try {
    r = await fetch(`${base}/rest/v1/grab_backup${path}`, {
      method,
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", ...(extra || {}) },
      body,
    });
  } catch (e) {
    throw new Error(`could not reach ${base} (${e.message}) - check the project URL, ad-blockers/VPN, or the page's content-security policy`);
  }
  const text = await r.text();
  if (!r.ok) {
    const hint = r.status === 404 ? " - table grab_backup missing? run the setup SQL in Supabase" : r.status === 401 || r.status === 403 ? " - check the anon key and the table policy (setup SQL)" : "";
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}${hint}`);
  }
  return text;
}

export const snapshot = (keys) => Object.fromEntries(keys.map((k) => { try { return [k, localStorage.getItem(k)]; } catch { return [k, null]; } }));

export async function fetchRemote(cfg, appId) {
  const t = await req(cfg, "GET", `?select=payload&app=eq.${encodeURIComponent(appId)}&k=eq.state`);
  const rows = JSON.parse(t || "[]");
  if (!rows[0]) return null;
  const env = JSON.parse(rows[0].payload);
  return env && env.data ? env : null;
}

export async function push(cfg, appId, keys) {
  const ts = Date.now();
  const data = snapshot(keys);
  const text = JSON.stringify({ v: 1, id: appId, ts, data });
  await req(cfg, "POST", "?on_conflict=app,k",
    JSON.stringify({ app: appId, k: "state", payload: text, updated_at: new Date().toISOString() }),
    { Prefer: "resolution=merge-duplicates,return=minimal" });
  return { ts, size: text.length, snap: JSON.stringify(data) };
}

export function applyEnvelope(env, keys) {
  keys.forEach((k) => {
    const v = env.data[k];
    try { if (typeof v === "string") localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ }
  });
}
