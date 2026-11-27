// FFmpeg mux / audio boost + modified date (ported from Link Nest). Pure helpers + the Python block
// that the generated script runs after the downloads. `MD` = { ffOn, db, del, dateOn, datetime }.
// Items carry: ff = { on, sub (undefined = auto-match, '' = none, else subtitle key), boost, db }, dt = true.
export const MD_VIDEO = /\.(mkv|mp4|avi|mov|m4v|wmv|ts|m2ts|mpg|mpeg|webm|flv|divx|vob)$/i;
export const MD_SUB = /\.(srt|ass|ssa|vtt|sub|idx|sup|smi)$/i;
export const mdClamp = (v, fb) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? Math.max(-60, Math.min(60, Math.round(n * 10) / 10)) : (fb === undefined ? 12 : fb); };
export const mdValidDt = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || '');
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60;
};
const mdStamp = dt => dt.replace('T', ' ') + ':00';
const mdStem = n => n.replace(/\.[A-Za-z0-9]{1,5}$/, '');
const mdEpisode = n => {
  const m = n.match(/S(\d{1,2})[ ._-]?E(\d{1,3})/i) || n.match(/(?:^|[ ._-])(\d{1,2})x(\d{2,3})(?![\dp])/i);
  return m ? parseInt(m[1], 10) + 'x' + parseInt(m[2], 10) : '';
};
const mdTokens = n => new Set(mdStem(n).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1));
const mdSim = (a, b) => {
  const A = mdTokens(a), B = mdTokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach(t => { if (B.has(t)) hit++; });
  return hit / Math.max(A.size, B.size);
};
// best video for a subtitle name: same episode first, then most shared words
const mdClosest = (sub, videos) => {
  const ep = mdEpisode(sub);
  const pool = ep ? videos.filter(v => mdEpisode(v) === ep) : videos;
  const list = pool.length ? pool : (ep ? [] : videos);
  let best, score = 0;
  list.forEach(v => { const s = mdSim(sub, v) + (ep ? 1 : 0); if (s > score) { score = s; best = v; } });
  return score >= (ep ? 1 : 0.34) ? best : undefined;
};
// videos/subs: [{ key, name }] -> { videoKey: subKey } (.srt preferred)
export function mdAutoSubs(videos, subs) {
  const out = {};
  if (!videos.length || !subs.length) return out;
  const names = videos.map(v => v.name);
  const byName = new Map(videos.map(v => [v.name, v]));
  const ordered = subs.slice().sort((a, b) => (/\.srt$/i.test(a.name) ? 0 : 1) - (/\.srt$/i.test(b.name) ? 0 : 1));
  ordered.forEach(s => {
    const m = mdClosest(s.name, names);
    const v = m && byName.get(m);
    if (v && !out[v.key]) out[v.key] = s.key;
  });
  return out;
}
export const mdOutName = (n, keep) => (keep ? n : (MD_VIDEO.test(n) ? n.replace(MD_VIDEO, '.mkv') : n + '.mkv'));
// What the script gets: ffmpeg jobs {videoKey: {sub, db}} and the dated item keys
export function mdPlan(base, keyOf, MD) {
  const out = { ffmpeg: {}, dates: [], stamp: '', del: !!MD.del };
  if (MD.ffOn) {
    const kv = i => ({ key: keyOf(i), name: i.name });
    const auto = mdAutoSubs(base.filter(i => !i.isDir && MD_VIDEO.test(i.name)).map(kv), base.filter(i => !i.isDir && MD_SUB.test(i.name)).map(kv));
    const subKeys = new Set(base.filter(i => !i.isDir && MD_SUB.test(i.name)).map(keyOf));
    base.forEach(i => {
      const c = i.ff;
      if (!c || !c.on || (!i.isDir && !MD_VIDEO.test(i.name))) return;
      const k = keyOf(i);
      let sub = '';
      if (!i.isDir) sub = c.sub === undefined ? (auto[k] || '') : (c.sub && subKeys.has(c.sub) ? c.sub : '');
      out.ffmpeg[k] = { sub, db: c.boost ? mdClamp(c.db, MD.db) : null };
    });
  }
  if (MD.dateOn && mdValidDt(MD.datetime)) {
    base.forEach(i => { if (i.dt) out.dates.push(keyOf(i)); });
    if (out.dates.length) out.stamp = mdStamp(MD.datetime);
  }
  return out;
}
const mdActive = p => Object.keys(p.ffmpeg).length > 0 || p.dates.length > 0;

const PY_MEDIA_OFF = `# No ffmpeg / modified-date step selected.
DL = {}  # local file -> picked item it came from

def post_process():
    pass
`;
const PY_MEDIA = `# FFmpeg (subtitle mux / audio boost -> .mkv) and modified date, chosen in the grab builder.
# FFMPEG: {picked item: {"sub": picked subtitle item or "", "db": dB boost or None}}
# DATES: picked items whose files get the modified date DATE_STAMP (notebook clock timezone)
import json, shutil, subprocess, tempfile, time
FFMPEG = json.loads(@FFMPEG@)
FFMPEG_DELETE = @FFDEL@
DATES = set(@DATES@)
DATE_STAMP = @STAMP@
VIDEO_EXT = (".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".ts", ".m2ts", ".mpg", ".mpeg", ".webm", ".flv", ".divx", ".vob")

DL = {}  # local file -> picked item it came from (filled while downloading)

def sub_codec(path):
    p = path.lower()
    if p.endswith((".ass", ".ssa")):
        return "ass"
    if p.endswith((".srt", ".vtt")):
        return "srt"
    return "copy"

def run_mux(vid, sub, out, db, delete):
    stamp = os.path.getmtime(vid)  # keep the video's last-modified date
    tmpdir = tempfile.mkdtemp(prefix="grab_ffmpeg_")
    tmp = os.path.join(tmpdir, os.path.basename(out))
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-stats", "-nostdin", "-y", "-i", vid]
    if sub:
        cmd += ["-i", sub, "-map", "0", "-map", "1", "-c:v", "copy"]
    else:
        cmd += ["-map", "0", "-ignore_unknown", "-c:v", "copy"]
    if db is not None:
        cmd += ["-af", f"volume={db}dB", "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-c:a", "copy"]
    cmd += ["-c:s", sub_codec(sub) if sub else "copy", tmp]
    print("FFmpeg ->", out)
    if subprocess.run(cmd).returncode != 0:
        shutil.rmtree(tmpdir, ignore_errors=True)
        print("Failed:", out)
        return False
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.move(tmp, out)
    os.utime(out, (stamp, stamp))
    shutil.rmtree(tmpdir, ignore_errors=True)
    if delete:
        if os.path.abspath(vid) != os.path.abspath(out):
            os.remove(vid)
        if sub and os.path.exists(sub):
            os.remove(sub)
    return True

def run_ffmpeg():
    if not shutil.which("ffmpeg"):
        subprocess.run("apt-get -qq update && apt-get -qq install -y ffmpeg > /dev/null", shell=True)
    by_item = {}
    for lp, it in DL.items():
        by_item.setdefault(it, []).append(lp)
    for it, cfg in FFMPEG.items():
        sub_it = cfg.get("sub") or ""
        sub = next(iter(by_item.get(sub_it, [])), "") if sub_it else ""
        db = cfg.get("db")
        for vid in sorted(by_item.get(it, [])):
            if not vid.lower().endswith(VIDEO_EXT) or not os.path.exists(vid):
                continue
            s = sub if sub and os.path.exists(sub) else ""
            keep = (not s) and db is not None  # boost only: keep the name and extension
            out = vid if keep else os.path.splitext(vid)[0] + ".mkv"
            if run_mux(vid, s, out, db, FFMPEG_DELETE):
                DL[out] = DL.get(vid, it)
                if FFMPEG_DELETE:
                    if out != vid:
                        DL.pop(vid, None)
                    if s:
                        DL.pop(s, None)

def post_process():
    if FFMPEG:
        run_ffmpeg()
    if DATES and DATE_STAMP:
        t = time.mktime(time.strptime(DATE_STAMP, "%Y-%m-%d %H:%M:%S"))
        for lp, it in DL.items():
            if it in DATES and os.path.exists(lp):
                os.utime(lp, (t, t))
                print("Dated:", lp, DATE_STAMP)
`;
export function mediaPy(base, keyOf, MD) {
  const p = mdPlan(base, keyOf, MD);
  if (!mdActive(p)) return PY_MEDIA_OFF;
  return PY_MEDIA
    .replace('@FFMPEG@', () => JSON.stringify(JSON.stringify(p.ffmpeg)))
    .replace('@FFDEL@', () => (p.del ? 'True' : 'False'))
    .replace('@DATES@', () => JSON.stringify(p.dates))
    .replace('@STAMP@', () => JSON.stringify(p.stamp));
}
// Colab list: directives on top + two extra fields per line (ffmpeg JSON, date flag)
export function mediaListHead(base, keyOf, MD) {
  const p = mdPlan(base, keyOf, MD);
  const h = [];
  if (Object.keys(p.ffmpeg).length && p.del) h.push('#@ffmpeg_delete 1');
  if (p.dates.length) h.push('#@date ' + p.stamp);
  return { plan: p, head: h };
}
export function listLine(i, plan, keyOf) {
  const k = keyOf(i);
  const ff = plan.ffmpeg[k] ? JSON.stringify(plan.ffmpeg[k]) : '';
  const dt = plan.dates.indexOf(k) >= 0 ? '1' : '0';
  const extra = ff || dt === '1' ? ' | ' + ff + ' | ' + dt : '';
  return i.name + ' | ' + i.dir + (i.nn || i.folder || extra ? ' | ' + (i.nn || '') + ' | ' + (i.folder || '') : '') + extra;
}


export const MEDIA_DEF = { ffOn: false, db: 12, del: false, dateOn: false, datetime: "" };
export const mediaActive = (base, keyOf, MD) => { const p = mdPlan(base, keyOf, MD); return Object.keys(p.ffmpeg).length + p.dates.length; };
