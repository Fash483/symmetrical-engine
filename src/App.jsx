import { useEffect, useMemo, useState } from "react";

const LS = "b2grab_v1";
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const FILE_RE = /^[^/\\]+\.[A-Za-z0-9]{2,5}$/;
const JUNK = [/^[\d.,]+\s*(bytes|[kmgt]b)$/i, /^\d{2}\/\d{2}\/\d{4}/, /^(name|size|created|buckets?|upload|download|delete|refresh)$/i];
const parseKw = (s) => s.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const normDir = (d) => { const p = d.split("/").map((x) => x.trim()).filter(Boolean); return "/" + p.join("/") + (p.length ? "/" : ""); };

function groupOf(name) {
  const clean = name.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|mpe?g|m4v)$/i, "");
  const m = clean.match(/^(.+?)[\s._-]+S(\d{1,2})(?=E\d|[\s._\])-]|$)/i) || clean.match(/^(.+?)[\s._-]+(\d{1,2})x\d{2}/i);
  if (!m) return { key: "~other", label: "Other", last: true };
  const t = m[1].replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const s = parseInt(m[2], 10);
  return { key: t.toLowerCase() + "|" + s, label: `${t} · S${String(s).padStart(2, "0")}` };
}

const TPL = `import os
import boto3
@AUTH@

B2_REGION = "@REGION@"
B2_BUCKET_NAME = "@BUCKET@"
LOCAL_DIR = "@LOCAL@"

# B2 keys of the folders/files picked (folders are expanded recursively)
ITEMS = @ITEMS@

# 0 = everything, 1 = first half of the files, 2 = second half
SPLIT_PART = @PART@

# Extra filter on file names (all must match). [] = no filter
FILE_KEYWORDS = @KW@

b2 = boto3.client(
    "s3",
    endpoint_url=f"https://s3.{B2_REGION}.backblazeb2.com",
    aws_access_key_id=B2_KEY_ID,
    aws_secret_access_key=B2_APPLICATION_KEY,
)

def ok(name):
    n = name.lower()
    return all(k.lower() in n for k in FILE_KEYWORDS)

def collect(key, out):
    key = key.rstrip("/")
    for page in b2.get_paginator("list_objects_v2").paginate(Bucket=B2_BUCKET_NAME, Prefix=key):
        for obj in page.get("Contents", []):
            k = obj["Key"]
            if k != key and not k.startswith(key + "/"):
                continue
            name = os.path.basename(k)
            if name and ok(name):
                out[k] = obj["Size"]

def download(key, size):
    fn = os.path.basename(key)
    os.makedirs(LOCAL_DIR, exist_ok=True)
    lp = os.path.join(LOCAL_DIR, fn)
    if os.path.exists(lp) and os.path.getsize(lp) == size:
        print("Skip (exists):", fn)
        return
    print("Downloading:", key)
    b2.download_file(B2_BUCKET_NAME, key, lp)

found = {}
for it in ITEMS:
    collect(it, found)
files = sorted(found)
total = len(files)
if SPLIT_PART:
    mid = (total + 1) // 2
    files = files[:mid] if SPLIT_PART == 1 else files[mid:]
print(f"{len(ITEMS)} items -> {total} files total | downloading {len(files)}")
if not total:
    print("Nothing matched - check paths, prefix and keywords.")
for k in files:
    download(k, found[k])
print("Download complete.")
`;

const AUTH = {
  kaggle: `from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
B2_KEY_ID = s.get_secret("B2_KEY_ID")
B2_APPLICATION_KEY = s.get_secret("B2_APPLICATION_KEY")`,
  colab: `B2_KEY_ID = "PUT_KEY_ID_HERE"
B2_APPLICATION_KEY = "PUT_APPLICATION_KEY_HERE"`,
};

const DEF = {
  bucket: "Arielleb", region: "us-east-005", prefix: "", dir: "/", kw: "", mode: "all", fileKw: "",
  part: 0, target: "kaggle", folders: true, paste: "", items: [],
};

export default function App() {
  const [s, setS] = useState(() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(LS)) }; } catch { return DEF; } });
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const set = (p) => setS((o) => ({ ...o, ...p }));
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);

  // Receive items from the userscript: URL hash (#b2=...) or window.postMessage
  useEffect(() => {
    const merge = (list) => {
      setS((o) => {
        const next = o.items.map((i) => ({ ...i }));
        const idx = new Map(next.map((i) => [i.dir + "\0" + i.name, i]));
        list.forEach((r) => {
          if (!r || typeof r.name !== "string" || typeof r.dir !== "string") return;
          const dir = normDir(r.dir), k = dir + "\0" + r.name, old = idx.get(k);
          if (old) { if (r.checked) old.checked = true; return; }
          const it = { name: r.name, dir, isDir: !!r.isDir, checked: !!r.checked };
          idx.set(k, it); next.push(it);
        });
        return { ...o, items: next };
      });
      setNotice(`Received ${list.length} item(s) from the userscript`);
    };
    const readHash = () => {
      const m = location.hash.match(/^#b2=(.+)$/);
      if (!m) return;
      try {
        const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const list = JSON.parse(new TextDecoder().decode(bytes));
        if (Array.isArray(list)) merge(list);
      } catch { setNotice("Could not read the items sent by the userscript"); }
      history.replaceState(null, "", location.pathname + location.search);
    };
    const allowed = /^https:\/\/(secure\.backblaze\.com|[\w-]+\.mygiga\.cloud)$/;
    const onMsg = (e) => {
      if (allowed.test(e.origin) && e.data && e.data.type === "b2grab-items" && Array.isArray(e.data.items)) merge(e.data.items);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("hashchange", readHash); window.removeEventListener("message", onMsg); };
  }, []);

  const setItems = (fn) => setS((o) => ({ ...o, items: fn(o.items) }));

  function addPasted() {
    const dir = normDir(s.dir);
    const have = new Set(s.items.map((i) => i.dir + "\0" + i.name));
    const add = [];
    s.paste.split("\n").forEach((raw) => {
      const name = raw.replace(/\s+/g, " ").trim().replace(/\/$/, "");
      if (!name || name.length > 300 || JUNK.some((r) => r.test(name))) return;
      const isFile = FILE_RE.test(name);
      if (!isFile && !s.folders) return;
      const k = dir + "\0" + name;
      if (have.has(k)) return;
      have.add(k);
      add.push({ name, dir, isDir: !isFile, checked: false });
    });
    set({ items: [...s.items, ...add], paste: "" });
  }

  const kws = parseKw(s.kw);
  const visible = useMemo(
    () => s.items.filter((i) => !kws.length || (s.mode === "any" ? kws.some((k) => i.name.toLowerCase().includes(k)) : kws.every((k) => i.name.toLowerCase().includes(k)))),
    [s.items, s.kw, s.mode] // eslint-disable-line
  );
  const groups = useMemo(() => {
    const m = new Map();
    visible.forEach((i) => { const g = groupOf(i.name); if (!m.has(g.key)) m.set(g.key, { ...g, items: [] }); m.get(g.key).items.push(i); });
    const arr = [...m.values()];
    arr.forEach((g) => g.items.sort((a, b) => nat(a.name, b.name)));
    return arr.sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0) || nat(a.label, b.label));
  }, [visible]);

  const ticked = visible.filter((i) => i.checked);
  const chosen = (ticked.length ? ticked : visible).slice().sort((a, b) => nat(a.dir + a.name, b.dir + b.name));
  const pre = s.prefix.replace(/^\/+|\/+$/g, "");
  const keys = chosen.map((i) => { const p = (i.dir + i.name).replace(/^\/+/, ""); return pre ? pre + "/" + p : p; });
  const code = TPL
    .replace("@AUTH@", () => AUTH[s.target])
    .replace("@REGION@", () => s.region)
    .replace("@BUCKET@", () => s.bucket)
    .replace("@LOCAL@", () => (s.target === "kaggle" ? "/kaggle/working/" : "/content/"))
    .replace("@ITEMS@", () => JSON.stringify(keys, null, 4))
    .replace("@PART@", () => String(s.part))
    .replace("@KW@", () => JSON.stringify(parseKw(s.fileKw)));

  const toggle = (it, v) => setItems((a) => a.map((x) => (x === it ? { ...x, checked: v } : x)));
  const toggleGroup = (g, v) => setItems((a) => a.map((x) => (g.items.includes(x) ? { ...x, checked: v } : x)));

  async function copy() {
    try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="wrap">
      <h1>B2 Grab Builder</h1>
      {notice && <section>✔ {notice}</section>}

      <section>
        <h2>1. Add items</h2>
        <small>On the Backblaze file list: select all, copy, paste below. Set the folder you were in first.</small>
        <input value={s.dir} onChange={(e) => set({ dir: e.target.value })} placeholder="Folder in bucket, e.g. /Shows/Scooby" />
        <textarea value={s.paste} onChange={(e) => set({ paste: e.target.value })} placeholder="Paste page text here" />
        <label className="chk"><input type="checkbox" checked={s.folders} onChange={(e) => set({ folders: e.target.checked })} />Lines without an extension are folders</label>
        <button className="go" onClick={addPasted}>Add to list</button>
      </section>

      <section>
        <h2>2. Pick ({s.items.length} stored · {visible.length} match · {ticked.length || "none"} ticked)</h2>
        <div className="row">
          <input value={s.kw} onChange={(e) => set({ kw: e.target.value })} placeholder="Keywords e.g. scooby 1080p" />
          <select style={{ flex: "0 0 80px" }} value={s.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="all">ALL</option><option value="any">ANY</option>
          </select>
        </div>
        <div className="row">
          <button onClick={() => setItems((a) => a.map((x) => (visible.includes(x) ? { ...x, checked: true } : x)))}>Select shown</button>
          <button onClick={() => setItems((a) => a.map((x) => ({ ...x, checked: false })))}>Clear ticks</button>
          <button onClick={() => confirm("Remove all stored items?") && set({ items: [] })}>Clear items</button>
        </div>
        <div style={{ maxHeight: "50vh", overflowY: "auto", marginTop: 6 }}>
          {groups.map((g) => {
            const n = g.items.filter((i) => i.checked).length;
            return (
              <details key={g.key} open>
                <summary>
                  <input type="checkbox" checked={n === g.items.length} ref={(el) => el && (el.indeterminate = n > 0 && n < g.items.length)}
                    onClick={(e) => e.stopPropagation()} onChange={(e) => toggleGroup(g, e.target.checked)} />
                  {g.label} ({g.items.length})
                </summary>
                {g.items.map((i) => (
                  <label className="item" key={i.dir + i.name}>
                    <input type="checkbox" checked={i.checked} onChange={(e) => toggle(i, e.target.checked)} />
                    <span>{i.isDir ? "📁 " : "🎞 "}{i.name}<br /><small>{i.dir}</small></span>
                  </label>
                ))}
              </details>
            );
          })}
        </div>
        <small>Nothing ticked = all matches are used.</small>
      </section>

      <section>
        <h2>3. Script</h2>
        <div className="row">
          <select value={s.target} onChange={(e) => set({ target: e.target.value })}>
            <option value="kaggle">Kaggle (secrets)</option><option value="colab">Colab (type keys in)</option>
          </select>
          <select value={s.part} onChange={(e) => set({ part: Number(e.target.value) })}>
            <option value={0}>Whole run</option><option value={1}>Part 1 of 2</option><option value={2}>Part 2 of 2</option>
          </select>
        </div>
        <input value={s.fileKw} onChange={(e) => set({ fileKw: e.target.value })} placeholder="Optional: filter file names inside folders (S01)" />
        <details>
          <summary>B2 settings</summary>
          <input value={s.bucket} onChange={(e) => set({ bucket: e.target.value })} placeholder="Bucket" />
          <input value={s.region} onChange={(e) => set({ region: e.target.value })} placeholder="Region e.g. us-east-005" />
          <input value={s.prefix} onChange={(e) => set({ prefix: e.target.value })} placeholder="Key prefix (optional)" />
        </details>
        <textarea readOnly value={code} style={{ minHeight: 220 }} />
        <button className="go" onClick={copy}>{copied ? "✔ Copied!" : "Copy script"}</button>
      </section>
    </div>
  );
}
