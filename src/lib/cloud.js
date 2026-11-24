// Cloud backup to Neon via its SQL-over-HTTP endpoint (https://<host>/sql).
// One row per (app, k) in table grab_backup; payload is a JSON envelope {v, ts, data}.

const cfgKey = (appId) => `grabcloud_cfg_${appId}`;
export const loadCfg = (appId) => { try { return JSON.parse(localStorage.getItem(cfgKey(appId))) || {}; } catch { return {}; } };
export const saveCfg = (appId, c) => { try { localStorage.setItem(cfgKey(appId), JSON.stringify(c)); } catch { /* ignore */ } };

let tableReady = false;
// Accepts the raw string or a psql '...' line. The HTTP endpoint needs the NON-pooled host.
export function neonConn(raw) {
  const m = String(raw || "").match(/postgres(?:ql)?:\/\/[^\s'"]+/i);
  if (!m) throw new Error("not a Neon connection string (should start with postgresql://)");
  return m[0].replace(/(@ep-[^./]*?)-pooler(?=\.)/i, "$1");
}
async function query(raw, sql, params = []) {
  const conn = neonConn(raw);
  const host = new URL(conn.replace(/^postgres(ql)?:/i, "https:")).host;
  let r;
  try {
    r = await fetch(`https://${host}/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Neon-Connection-String": conn },
      body: JSON.stringify({ query: sql, params }),
    });
  } catch (e) {
    throw new Error(`could not reach ${host} (${e.message}) - check the connection string, and disable ad/privacy blockers for this site`);
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
async function init(conn) {
  if (tableReady) return;
  await query(conn, "create table if not exists grab_backup (app text not null, k text not null, payload text not null, updated_at timestamptz not null default now(), primary key (app, k))");
  tableReady = true;
}

export const snapshot = (keys) => Object.fromEntries(keys.map((k) => { try { return [k, localStorage.getItem(k)]; } catch { return [k, null]; } }));

export async function fetchRemote(conn, appId) {
  await init(conn);
  const r = await query(conn, "select payload from grab_backup where app = $1 and k = $2", [appId, "state"]);
  const p = r.rows && r.rows[0] && r.rows[0].payload;
  if (!p) return null;
  const env = JSON.parse(p);
  return env && env.data ? env : null;
}

export async function push(conn, appId, keys) {
  await init(conn);
  const ts = Date.now();
  const data = snapshot(keys);
  const text = JSON.stringify({ v: 1, id: appId, ts, data });
  await query(conn, "insert into grab_backup (app, k, payload) values ($1, $2, $3) on conflict (app, k) do update set payload = excluded.payload, updated_at = now()", [appId, "state", text]);
  return { ts, size: text.length, snap: JSON.stringify(data) };
}

export function applyEnvelope(env, keys) {
  keys.forEach((k) => {
    const v = env.data[k];
    try { if (typeof v === "string") localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ }
  });
}
