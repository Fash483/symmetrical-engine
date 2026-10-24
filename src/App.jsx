import { useEffect, useMemo, useState } from "react";

const LS = "b2grab_v2";
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const FILE_RE = /^[^/\\]+\.[A-Za-z0-9]{2,5}$/;
const JUNK = [/^[\d.,]+\s*(bytes|[kmgt]b)$/i, /^\d{2}\/\d{2}\/\d{4}/, /^(name|size|created|buckets?|upload|download|delete|refresh)$/i];
const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i;
const isDateLine = (t) => { const m = t.match(DATE_RE); return !!m && m.index === 0; };
const dateTs = (str, mdy) => {
  const m = typeof str === "string" && str.match(DATE_RE);
  if (!m) return null;
  const [a, b, y] = [+m[1], +m[2], +m[3]];
  let h = m[4] ? +m[4] : 0;
  if (m[7]) { const pm = m[7].toUpperCase() === "PM"; h = (h % 12) + (pm ? 12 : 0); }
  return Date.UTC(y, (mdy ? a : b) - 1, mdy ? b : a, h, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
};
const parseKw = (s) => s.split(/[,\n]+|\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const normDir = (d) => { const p = d.split("/").map((x) => x.trim()).filter(Boolean); return "/" + p.join("/") + (p.length ? "/" : ""); };

function groupOf(name, by) {
  const other = { key: "~other", label: "Other", last: true };
  if (by === "off") return other;
  const clean = name.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|mpe?g|m4v)$/i, "");
  const m = clean.match(/^(.+?)[\s._-]+S(\d{1,2})(?=E\d|[\s._\])-]|$)/i) || clean.match(/^(.+?)[\s._-]+(\d{1,2})x\d{2}/i);
  if (!m) return other;
  const t = m[1].replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const s = parseInt(m[2], 10);
  if (by === "series") return { key: t.toLowerCase(), label: t };
  return { key: t.toLowerCase() + "|" + s, label: `${t} · S${String(s).padStart(2, "0")}` };
}

const TPL = `# @HEADER@
import os
import boto3
@AUTH@

B2_REGION = "@REGION@"
B2_BUCKET_NAME = "@BUCKET@"
LOCAL_DIR = "/kaggle/working/"

# B2 keys of the folders/files picked (folders are expanded recursively)
ITEMS = @ITEMS@

# 0 = download everything, 1 = first half of the FILES, 2 = second half of the FILES
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
    paginator = b2.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=B2_BUCKET_NAME, Prefix=key):
        for obj in page.get("Contents", []):
            k = obj["Key"]
            if k != key and not k.startswith(key + "/"):
                continue
            name = os.path.basename(k)
            if not name or not ok(name):
                continue
            out[k] = obj["Size"]

def download(key, size):
    fn = os.path.basename(key)
    os.makedirs(LOCAL_DIR, exist_ok=True)
    lp = os.path.join(LOCAL_DIR, fn)
    if os.path.exists(lp) and os.path.getsize(lp) == size:
        print("Skip (exists):", fn)
        return
    print("Downloading: s3://" + B2_BUCKET_NAME + "/" + key)
    b2.download_file(B2_BUCKET_NAME, key, lp)

def main():
    found = {}
    for it in ITEMS:
        collect(it, found)
    files = sorted(found)
    total = len(files)
    if SPLIT_PART:
        mid = (total + 1) // 2
        files = files[:mid] if SPLIT_PART == 1 else files[mid:]
    print(f"{len(ITEMS)} items -> {total} files total | "
          f"downloading {len(files)} (SPLIT_PART={SPLIT_PART})")

    for k in files:
        download(k, found[k])
    print("Download complete.")

if __name__ == "__main__":
    main()
`;

const AUTH_KAGGLE = `from kaggle_secrets import UserSecretsClient

s = UserSecretsClient()
B2_KEY_ID = s.get_secret("B2_KEY_ID")
B2_APPLICATION_KEY = s.get_secret("B2_APPLICATION_KEY")`;

// Downloads a txt (line 1 = key id, line 2 = application key), reads it, then deletes it.
const AUTH_URL = `import re
import urllib.request
from urllib.parse import urljoin

CREDS_URL = @CREDS_URL@
CREDS_FILE = "/kaggle/working/b2_creds.txt"

def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", ""), r.geturl()

def load_creds():
    data, ctype, final = _get(CREDS_URL)
    if "html" in ctype.lower():  # a download page: follow its download link
        html = data.decode("utf-8", "ignore")
        links = re.findall(r"""href=["']([^"']+)["']""", html)
        pick = [l for l in links if ".txt" in l.lower() or "download" in l.lower()]
        if not pick:
            raise RuntimeError("No download link found on the credentials page")
        data, ctype, final = _get(urljoin(final, pick[0]))
    with open(CREDS_FILE, "wb") as f:
        f.write(data)
    try:
        with open(CREDS_FILE, encoding="utf-8-sig") as f:
            lines = [l.strip() for l in f.read().splitlines() if l.strip()]
        if len(lines) < 2:
            raise RuntimeError("Credentials txt needs the key id on line 1 and the application key on line 2")
        return lines[0], lines[1]
    finally:
        os.remove(CREDS_FILE)  # always remove the txt

B2_KEY_ID, B2_APPLICATION_KEY = load_creds()`;

const DEF_CREDS_URL = "https://tfnqdcsnbmpckvjkitqs.supabase.co/functions/v1/download-page/f900acc7-3930-4f8a-8bdb-2ff76566fa98";

const DEF = {
  auth: "kaggle", credsUrl: DEF_CREDS_URL,
  bucket: "Arielleb", region: "us-east-005", prefix: "", dir: "/", kw: "", mode: "all", fileKw: "",
  group: "season", sort: "name", split: false, colab: false, folders: true, paste: "", items: [],
};

const CSS = `
#fgb{max-width:640px;margin:0 auto;padding:10px;box-sizing:border-box;color:#72243E;font:14px sans-serif}
#fgb *{box-sizing:border-box}
#fgb-panel{position:relative;background:#fff;border:3px dashed #D4537E;border-radius:18px;padding:12px;display:flex;flex-direction:column}
#fgb .fgb-st{position:absolute;pointer-events:none}
#fgb-head{background:#F4C0D1;border-radius:10px;padding:7px 12px;font-weight:600;font-size:16px;margin:0 56px 8px 0}
#fgb-notice{background:#FBEAF0;border:1.5px dotted #D4537E;border-radius:10px;padding:6px 10px;margin:0 0 6px;font-size:13px}
#fgb input:not([type=checkbox]),#fgb select,#fgb textarea{width:100%;font-size:15px;padding:8px 10px;margin:3px 0;background:#FBEAF0;color:#72243E;
  border:1.5px dotted #D4537E;border-radius:10px;font-family:inherit}
#fgb textarea{resize:vertical;min-height:70px}
#fgb input::placeholder,#fgb textarea::placeholder{color:#B5698A}
#fgb input[type=checkbox]{accent-color:#D4537E}
#fgb button{font-size:14px;font-weight:600;padding:9px 4px;margin:3px 0;background:#fff;color:#993556;border:2px solid #D4537E;border-radius:10px;cursor:pointer}
#fgb button.go{background:#D4537E;color:#fff}
#fgb .row{display:flex;gap:6px;align-items:center}
#fgb .row>*{flex:1;min-width:0}
#fgb .chkrow{display:flex;align-items:center;gap:10px;padding:6px 2px}
#fgb .chkrow input{flex:0 0 26px;width:26px;height:26px;margin:0}
#fgb-list{overflow-y:auto;max-height:50vh;min-height:90px;margin:4px 0}
#fgb-list label{display:flex;gap:8px;padding:7px 8px;margin-bottom:4px;background:#FBEAF0;border:1.5px dotted #ED93B1;border-radius:10px;align-items:flex-start;word-break:break-all}
#fgb-list label.sub{margin-left:14px}
#fgb-list input{flex:0 0 20px;width:20px;height:20px;margin:0}
#fgb-list .gh{display:flex;gap:8px;padding:8px;margin:6px 0 4px;background:#F4C0D1;border-radius:10px;align-items:center;font-weight:600}
#fgb-list .gh span{flex:1;word-break:break-word;cursor:pointer}
#fgb-info{font-size:12px;color:#993556;margin:2px 0}
#fgb details.box{margin:4px 0;border:1.5px dotted #ED93B1;border-radius:10px;padding:4px 8px}
#fgb details.box>summary{font-weight:600;cursor:pointer;padding:4px 0}
#fgb small{font-size:12px;color:#993556}
`;

const Cloud = () => (
  <svg className="fgb-st" style={{ right: 8, top: 6 }} width="46" height="30" viewBox="0 0 46 30"><ellipse cx="23" cy="20" rx="20" ry="8" fill="#fff" stroke="#ED93B1" strokeWidth="2" /><circle cx="14" cy="14" r="8" fill="#fff" stroke="#ED93B1" strokeWidth="2" /><circle cx="27" cy="11" r="10" fill="#fff" stroke="#ED93B1" strokeWidth="2" /><ellipse cx="23" cy="20" rx="17" ry="6" fill="#fff" /><circle cx="20" cy="18" r="1.6" fill="#72243E" /><circle cx="29" cy="18" r="1.6" fill="#72243E" /></svg>
);
const Sparkle = () => (
  <svg className="fgb-st" style={{ right: 10, bottom: 56, transform: "rotate(14deg)" }} width="28" height="28" viewBox="0 0 24 24"><path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10Z" fill="#FAC775" stroke="#fff" strokeWidth="1.5" /></svg>
);
const Heart = () => (
  <svg className="fgb-st" style={{ left: -4, bottom: -4, transform: "rotate(-8deg)" }} width="30" height="30" viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="#ED93B1" stroke="#fff" strokeWidth="2" /></svg>
);

export default function App() {
  const [s, setS] = useState(() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(LS)) }; } catch { return DEF; } });
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const set = (p) => setS((o) => ({ ...o, ...p }));
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);

  // Receive items from the userscript: URL hash (#b2=...) or window.postMessage
  useEffect(() => {
    const merge = (list) => {
      setS((o) => {
        const next = o.items.map((i) => ({ ...i }));
        const idx = new Map(next.map((i) => [i.dir + "\0" + i.name, i]));
        let seq = next.reduce((m, i) => Math.max(m, (i.idx ?? -1) + 1), 0);
        list.forEach((r) => {
          if (!r || typeof r.name !== "string" || typeof r.dir !== "string") return;
          const dir = normDir(r.dir), k = dir + "\0" + r.name, old = idx.get(k);
          const date = typeof r.date === "string" ? r.date : "";
          if (old) { if (r.checked) old.checked = true; if (typeof r.isDir === "boolean") old.isDir = r.isDir; if (date) old.date = date; return; }
          const it = { name: r.name, dir, isDir: !!r.isDir, checked: !!r.checked, idx: seq++, date };
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
    const allowed = /^https:\/\/(secure\.backblaze\.com|[\w-]+\.secure\.backblaze\.com|[\w-]+\.mygiga\.cloud)$/;
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
    const items = s.items.map((i) => ({ ...i }));
    const map = new Map(items.map((i) => [i.dir + "\0" + i.name, i]));
    let seq = items.reduce((m, i) => Math.max(m, (i.idx ?? -1) + 1), 0);
    let last = null, added = 0, dated = 0;
    const setDate = (it, d) => { if (it && d && !it.date) { it.date = d; dated++; } };
    s.paste.split("\n").forEach((rawLine) => {
      const cells = rawLine.split("\t").map((c) => c.trim()).filter(Boolean);
      const dateCell = cells.find((c) => DATE_RE.test(c) && isDateLine(c));
      const first = (cells.length > 1 ? cells[0] : rawLine).replace(/\s+/g, " ").trim().replace(/\/$/, "");
      // a line that is only a date belongs to the previous name
      if (first && isDateLine(first) && cells.length <= 1) { setDate(last, first); return; }
      const name = first;
      if (!name || name.length > 300 || JUNK.some((r) => r.test(name))) return;
      const isFile = FILE_RE.test(name);
      if (!isFile && !s.folders) return;
      const k = dir + "\0" + name;
      let it = map.get(k);
      if (!it) {
        it = { name, dir, isDir: !isFile, checked: false, idx: seq++, date: "" };
        map.set(k, it); items.push(it); added++;
      }
      last = it;
      if (dateCell) setDate(it, dateCell);
    });
    set({ items, paste: "" });
    setNotice(`Added ${added} item(s)${dated ? `, ${dated} with upload date` : ""}`);
  }

  // dd/mm vs mm/dd: infer from the data (a part > 12 settles it), default US order
  const mdy = useMemo(() => {
    let dm = false, md = false;
    s.items.forEach((i) => { const m = i.date && i.date.match(DATE_RE); if (m) { if (+m[1] > 12) dm = true; if (+m[2] > 12) md = true; } });
    return md || !dm;
  }, [s.items]);
  const isDateSort = s.sort === "date" || s.sort === "date-desc";
  const itemCmp = (a, b) => {
    if (a.dir !== b.dir) return nat(a.dir, b.dir);
    if (s.sort === "page" && a.idx != null && b.idx != null) return a.idx - b.idx;
    if (isDateSort) {
      const x = dateTs(a.date, mdy), y = dateTs(b.date, mdy);
      if (x != null && y != null && x !== y) return s.sort === "date" ? x - y : y - x;
      if ((x == null) !== (y == null)) return x == null ? 1 : -1; // undated last
    }
    return nat(a.name, b.name);
  };

  const kws = parseKw(s.kw);
  const visible = useMemo(
    () => s.items.filter((i) => !kws.length || (s.mode === "any" ? kws.some((k) => i.name.toLowerCase().includes(k)) : kws.every((k) => i.name.toLowerCase().includes(k)))),
    [s.items, s.kw, s.mode] // eslint-disable-line
  );
  const groups = useMemo(() => {
    const m = new Map();
    visible.forEach((i) => { const g = groupOf(i.name, s.group); if (!m.has(g.key)) m.set(g.key, { ...g, items: [] }); m.get(g.key).items.push(i); });
    const arr = [...m.values()];
    arr.forEach((g) => g.items.sort(itemCmp));
    return arr.sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0) || (s.sort === "page" ? (a.items[0].idx ?? 0) - (b.items[0].idx ?? 0) : isDateSort ? itemCmp(a.items[0], b.items[0]) || nat(a.label, b.label) : nat(a.label, b.label)));
  }, [visible, s.group, s.sort, mdy]); // eslint-disable-line

  const ticked = visible.filter((i) => i.checked);
  const base = (ticked.length ? ticked : visible).slice().sort(itemCmp);
  const pre = s.prefix.replace(/^\/+|\/+$/g, "");
  const keys = base.map((i) => { const p = (i.dir + i.name).replace(/^\/+/, ""); return pre ? pre + "/" + p : p; });
  const multiDir = new Set(s.items.map((i) => i.dir)).size > 1;

  function buildPython(part) {
    const header = part
      ? `PART ${part} of 2 - splits the FILES inside ${keys.length} selected item(s)`
      : `FULL RUN, no split (${keys.length} selected item(s))`;
    const names = base.map((i) => "# - " + i.name).join("\n");
    return TPL
      .replace("@HEADER@", () => header + "\n" + names)
      .replace("@AUTH@", () => (s.auth === "url" ? AUTH_URL.replace("@CREDS_URL@", () => JSON.stringify(s.credsUrl.trim())) : AUTH_KAGGLE))
      .replace("@PART@", () => String(part || 0))
      .replace("@REGION@", () => s.region)
      .replace("@BUCKET@", () => s.bucket)
      .replace("@ITEMS@", () => JSON.stringify(keys, null, 4))
      .replace("@KW@", () => JSON.stringify(parseKw(s.fileKw)));
  }
  function buildList() {
    return ["# " + base.length + " item(s)", ...base.map((i) => "# - " + i.name), ...base.map((i) => i.name + " | " + i.dir)].join("\n");
  }

  const toggle = (it, v) => setItems((a) => a.map((x) => (x === it ? { ...x, checked: v } : x)));
  const toggleGroup = (g, v) => setItems((a) => a.map((x) => (g.items.includes(x) ? { ...x, checked: v } : x)));

  async function copy(part, id) {
    const code = s.colab ? buildList() : buildPython(part);
    try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
    setCopied(id); setTimeout(() => setCopied(""), 1500);
  }

  const here = s.items.filter((i) => i.dir === normDir(s.dir)).length;
  const mode = s.colab ? ` → Colab list of ${base.length} item(s)`
    : s.split ? " → split by FILE: Part 1 = first half, Part 2 = second half"
    : ` → ${base.length} item(s) in script`;
  const info = `${s.items.length} stored (${here} here) · ${visible.length} match · ${ticked.length || "none"} ticked${mode}${ticked.length ? "" : " (nothing ticked = all matches)"} · dir ${normDir(s.dir)}`;

  const renderItem = (i, sub) => (
    <label className={sub ? "sub" : ""} key={i.dir + i.name}>
      <input type="checkbox" checked={i.checked} onChange={(e) => toggle(i, e.target.checked)} />
      <span>{i.isDir ? "📁 " : "🎞 "}{i.name}{multiDir && <small style={{ display: "block", opacity: 0.65 }}>{i.dir}</small>}{isDateSort && i.date && <small style={{ display: "block", opacity: 0.65 }}>{i.date}</small>}</span>
    </label>
  );

  return (
    <div id="fgb">
      <style>{CSS}</style>
      <div id="fgb-panel">
        <Cloud /><Sparkle /><Heart />
        <div id="fgb-head">Grab builder (B2)</div>
        {notice && <div id="fgb-notice">✔ {notice}</div>}

        <details className="box">
          <summary>＋ Add items (paste)</summary>
          <small>On the Backblaze file list: select all, copy, paste below. Set the folder you were in first.</small>
          <input value={s.dir} onChange={(e) => set({ dir: e.target.value })} placeholder="Folder in bucket, e.g. /Shows/Scooby" />
          <textarea value={s.paste} onChange={(e) => set({ paste: e.target.value })} placeholder="Paste page text here" />
          <label className="chkrow"><input type="checkbox" checked={s.folders} onChange={(e) => set({ folders: e.target.checked })} /><span>Lines without an extension are folders</span></label>
          <button className="go" style={{ width: "100%" }} onClick={addPasted}>Add to list</button>
        </details>

        <div className="row">
          <input value={s.kw} onChange={(e) => set({ kw: e.target.value })} placeholder="Keywords e.g. scooby 1080p" />
          <select style={{ flex: "0 0 80px" }} value={s.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="all">ALL</option><option value="any">ANY</option>
          </select>
        </div>
        <div className="row">
          <select value={s.group} onChange={(e) => set({ group: e.target.value })}>
            <option value="season">Group: series + season</option><option value="series">Group: series only</option><option value="off">No grouping</option>
          </select>
          <select value={s.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="name">Sort: name</option><option value="page">Sort: page order</option>
            <option value="date">Sort: upload date (oldest)</option><option value="date-desc">Sort: upload date (newest)</option>
          </select>
        </div>

        <label className="chkrow">
          <input type="checkbox" checked={s.colab} onChange={(e) => set({ colab: e.target.checked })} />
          <span>Colab mode (name | directory list)</span>
        </label>
        {!s.colab && <input value={s.fileKw} onChange={(e) => set({ fileKw: e.target.value })} placeholder="Optional: filter files inside folders (S01)" />}
        {!s.colab && (
          <label className="chkrow">
            <input type="checkbox" checked={s.split} onChange={(e) => set({ split: e.target.checked })} />
            <span>Split files into 2 halves (copy each separately)</span>
          </label>
        )}
        {!s.colab && (
          <select value={s.auth} onChange={(e) => set({ auth: e.target.value })}>
            <option value="kaggle">Credentials: Kaggle secrets</option>
            <option value="url">Credentials: download txt (id + key), then delete it</option>
          </select>
        )}
        {!s.colab && s.auth === "url" && (
          <input value={s.credsUrl} onChange={(e) => set({ credsUrl: e.target.value })} placeholder="URL of the credentials txt" />
        )}
        {!s.colab && (
          <details className="box">
            <summary>B2 settings</summary>
            <input value={s.bucket} onChange={(e) => set({ bucket: e.target.value })} placeholder="Bucket" />
            <input value={s.region} onChange={(e) => set({ region: e.target.value })} placeholder="Region e.g. us-east-005" />
            <input value={s.prefix} onChange={(e) => set({ prefix: e.target.value })} placeholder="Key prefix (optional)" />
          </details>
        )}

        <div id="fgb-info">{info}</div>
        <div id="fgb-list">
          {s.group === "off"
            ? visible.slice().sort(itemCmp).map((i) => renderItem(i, false))
            : groups.map((g) => {
                const n = g.items.filter((i) => i.checked).length;
                const isCol = collapsed.has(g.key);
                return (
                  <div key={g.key}>
                    <div className="gh">
                      <input type="checkbox" checked={n === g.items.length} ref={(el) => el && (el.indeterminate = n > 0 && n < g.items.length)}
                        onChange={(e) => toggleGroup(g, e.target.checked)} />
                      <span onClick={() => setCollapsed((c) => { const x = new Set(c); x.has(g.key) ? x.delete(g.key) : x.add(g.key); return x; })}>
                        {(isCol ? "▸ " : "▾ ") + g.label + " (" + g.items.length + ")"}
                      </span>
                    </div>
                    {!isCol && g.items.map((i) => renderItem(i, true))}
                  </div>
                );
              })}
        </div>

        <div className="row">
          <button onClick={() => setItems((a) => a.map((x) => (visible.includes(x) ? { ...x, checked: true } : x)))}>Select shown</button>
          <button onClick={() => setItems((a) => a.map((x) => ({ ...x, checked: false })))}>Clear selection</button>
        </div>
        <div className="row">
          {s.colab || !s.split ? (
            <button className="go" onClick={() => copy(0, "all")}>{copied === "all" ? "✔ Copied!" : s.colab ? "Copy list" : "Copy script"}</button>
          ) : (
            <>
              <button className="go" onClick={() => copy(1, "p1")}>{copied === "p1" ? "✔ Copied!" : "Copy part 1"}</button>
              <button className="go" onClick={() => copy(2, "p2")}>{copied === "p2" ? "✔ Copied!" : "Copy part 2"}</button>
            </>
          )}
        </div>
        <div className="row">
          <button onClick={() => confirm("Remove ALL stored items from every folder?") && set({ items: [] })}>Clear items</button>
        </div>
      </div>
    </div>
  );
}
