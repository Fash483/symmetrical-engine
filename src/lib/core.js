// Ported from Link Nest (src/lib/renamer.ts, folder-tree.ts, sizes.ts). Do not edit by hand.
const UNIT = { B: 0, K: 1, M: 2, G: 3, T: 4 };
export const SIZE_IN_TEXT = /(?<![A-Za-z0-9])(\d+(?:[.,]\d+)?)\s*([KMGT]i?B|bytes?|B)(?![A-Za-z0-9])/gi;
export function parseSize(text) {
  const all = [...text.matchAll(SIZE_IN_TEXT)];
  const m = all[all.length - 1];
  if (!m)
    return;
  const n = parseFloat(m[1].replace(",", "."));
  const u = UNIT[m[2][0].toUpperCase()];
  if (!Number.isFinite(n) || u === undefined)
    return;
  return Math.round(n * 1024 ** u);
}
export function formatBytes(b) {
  if (!Number.isFinite(b) || b < 0)
    return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}
export function totalBytes(urls, sizes) {
  let total = 0;
  let known = 0;
  for (const u of urls) {
    const s = sizes[u];
    if (typeof s === "number" && s > 0) {
      total += s;
      known++;
    }
  }
  return { total, known };
}
export function normalizeSizes(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [u, n] of Object.entries(raw))
      if (typeof n === "number" && Number.isFinite(n) && n > 0)
        out[u] = n;
  }
  return out;
}

const EXT = /\.[A-Za-z0-9]{2,5}$/;
const unquote = (l) => l.replace(/^\s*#\s*/, "").replace(/[\s,\\]+$/, "").trim().replace(/^(["'`])(.*)\1$/, "$2").trim();
const LABELLED = /^\s*(file\s*name|complete\s*name|release\s*name|name)\s*\.*\s*:\s*(\S.*?)\s*$/i;
const SIZE_LABEL = /^\s*(?:file\s*size|size)\s*\.*\s*:\s*(\S.*?)\s*$/i;
const labelledEntries = (lines) => {
  const out = [];
  let open = false;
  for (const l of lines) {
    const m = l.match(LABELLED);
    if (m) {
      const v = unquote(m[2]).replace(/^.*[\\/]/, "").trim();
      if (/^name$/i.test(m[1]) && !KNOWN_EXT.test(v))
        continue;
      if (v) {
        out.push({ name: v });
        open = true;
      }
      continue;
    }
    const sm = open && l.match(SIZE_LABEL);
    if (sm) {
      const b = parseSize(sm[1]);
      if (b) {
        out[out.length - 1].bytes = b;
        open = false;
      }
    }
  }
  return out;
};
export const parseNameEntries = (text) => {
  const lines = text.split(/\r?\n/);
  const labelled = labelledEntries(lines);
  if (labelled.length)
    return labelled;
  return lines.map(unquote).filter(Boolean).map((name) => {
    const bytes = parseSize(name);
    return bytes ? { name, bytes } : { name };
  });
};
export const parseNameList = (text) => parseNameEntries(text).map((e) => e.name);
const clean = (s) => s.replace(/[\\/\0-\x1f]/g, "_").replace(/\s+/g, " ").trim();
const KNOWN_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|flv|webm|ts|m2ts|mpg|mpeg|mp3|m4a|flac|wav|ogg|aac|srt|ass|ssa|sub|vtt|idx|nfo|jpg|jpeg|png|gif|webp|zip|rar|7z|iso|pdf|epub|cbz|cbr|txt)$/i;
const splitExt = (n, oldName) => {
  const oldExt = oldName.match(EXT)?.[0] ?? "";
  if (oldExt && n.toLowerCase().endsWith(oldExt.toLowerCase()) && n.length > oldExt.length)
    return [n.slice(0, -oldExt.length), n.slice(-oldExt.length)];
  const m = n.match(KNOWN_EXT);
  if (m && n.length > m[0].length)
    return [n.slice(0, -m[0].length), m[0]];
  return [n, ""];
};
const swapSeparators = (n, oldName, dots) => {
  if (dots === "off")
    return n;
  const [stem, ext] = splitExt(n, oldName);
  const out = dots === "dots-to-spaces" ? stem.replace(/\./g, " ").replace(/\s+/g, " ").trim() : stem.replace(/\s+/g, ".").replace(/^\.+|\.+$/g, "");
  return out + ext;
};
const SIZE_RE = /[\s\-–—|·•,:]*[[(]?\s*(?<![A-Za-z0-9])\d+(?:[.,]\d+)?\s*(?:[KMGT]i?B|bytes?)(?![A-Za-z0-9])\s*[\])]?/gi;
const AFTER_EXT = new RegExp(`^(.*${KNOWN_EXT.source.replace(/\$$/, "")})(?=\\s)\\s.*$`, "i");
const escRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sepFor = (stem) => {
  const dots = (stem.match(/\./g) ?? []).length;
  const spaces = (stem.match(/ /g) ?? []).length;
  return dots && dots >= spaces ? "." : " ";
};
const stemExt = (t) => {
  const ext = t.match(KNOWN_EXT)?.[0] ?? "";
  return [ext && t.length > ext.length ? t.slice(0, -ext.length) : t, ext];
};
const WORD = /[^ .]+/g;
const TRIM_SEP = /^[\s.\-–—_]+|[\s.\-–—_]+$/g;
const findSpot = (line, a) => {
  const [stem] = stemExt(line);
  const idx = stem.toLowerCase().indexOf(a.toLowerCase());
  if (idx < 0)
    return null;
  const before = stem.slice(0, idx);
  const after = stem.slice(idx + a.length);
  const joiner = (x) => /^[ .]+$/.test(x) ? "\x00" : x;
  const lead = before.replace(TRIM_SEP, "") ? joiner(before.match(/[ ._\-–—]*$/)[0]) : undefined;
  const trail = after.replace(TRIM_SEP, "") ? joiner(after.match(/^[ ._\-–—]*/)[0]) : undefined;
  if (!before.replace(TRIM_SEP, ""))
    return { kind: "start", trail };
  if (!after.replace(TRIM_SEP, ""))
    return { kind: "end", lead };
  const spot = { kind: "mid", lead, trail };
  if (/[ .]$/.test(before) || /[-–—_]\s*$/.test(before))
    spot.prev = before.replace(TRIM_SEP, "").split(/[ .]+/).pop()?.toLowerCase();
  if (/^[ .]/.test(after) || /^\s*[-–—_]/.test(after))
    spot.next = after.replace(TRIM_SEP, "").split(/[ .]+/)[0]?.toLowerCase();
  return spot;
};
const topKeys = (m) => [...m].sort((x, y) => y[1] - x[1]).map(([k]) => k);
const KINDS = [
  /\d{3,4}p|4k|2160p|uhd/i,
  /web-?dl|webrip|web|blu-?ray|bdrip|brrip|hdtv|dvdrip|hdrip/i,
  /[xh]\.?26[45]|hevc|avc|xvid/i,
  /dd[p+]{0,2}\d\.\d|aac\d?(?:\.\d)?|e?ac3|dts(?:-hd)?|truehd|atmos|flac/i,
  /repack\d?|proper/i
];
const KIND_ANY = new RegExp(KINDS.map((k) => `(?:${k.source})`).join("|"), "i");
const replaceSameKind = (stem, a) => {
  const sub = (i, len, w) => stem.slice(0, i) + w + stem.slice(i + len);
  const same = (x) => x.toLowerCase() === a.toLowerCase();
  if (/^-[A-Za-z0-9]+$/.test(a)) {
    const g = stem.match(/-[A-Za-z0-9]+$/);
    if (g && !same(g[0]) && !KIND_ANY.test(g[0].slice(1)))
      return sub(g.index, g[0].length, a);
    return null;
  }
  if (/^[[(][^\])]{2,}[\])]$/.test(a)) {
    const tags = [...stem.matchAll(/\[[^\]]{2,}\]|\([^)]{2,}\)/g)].filter((m) => !/^[[(]\s*(?:19|20)\d{2}\s*[\])]$/.test(m[0]) && !/^[[(]\s*\d+(?:[.,]\d+)?\s*[KMGT]i?B/i.test(m[0]) && !KIND_ANY.test(m[0]));
    if (tags.length === 1 && !same(tags[0][0]))
      return sub(tags[0].index, tags[0][0].length, a);
    return null;
  }
  for (const k of KINDS) {
    if (!new RegExp(`^(?:${k.source})$`, "i").test(a))
      continue;
    const re = new RegExp(`(?<![A-Za-z0-9])(?:${k.source})(?![A-Za-z0-9])`, "i");
    const m = stem.match(re);
    if (m && !same(m[0]))
      return sub(m.index, m[0].length, a);
    return null;
  }
  return null;
};
const placeOne = (line, a, at, spots) => {
  const [stem, ext] = stemExt(line);
  const sep = sepFor(stem);
  if (at === "auto") {
    const swapped = replaceSameKind(stem, a);
    if (swapped !== null)
      return swapped + ext;
  }
  if (at === "start")
    return a + sep + stem + ext;
  if (at === "end" || !spots.length)
    return stem + sep + a + ext;
  const n = { start: 0, mid: 0, end: 0 };
  const prevs = new Map;
  const nexts = new Map;
  const leads = new Map;
  const trails = new Map;
  for (const s of spots) {
    n[s.kind]++;
    if (s.lead !== undefined)
      leads.set(s.lead, (leads.get(s.lead) ?? 0) + 1);
    if (s.trail !== undefined)
      trails.set(s.trail, (trails.get(s.trail) ?? 0) + 1);
    if (s.prev)
      prevs.set(s.prev, (prevs.get(s.prev) ?? 0) + 1);
    if (s.next)
      nexts.set(s.next, (nexts.get(s.next) ?? 0) + 1);
  }
  const join = (m) => {
    const k = topKeys(m)[0];
    return k === undefined || k === "\x00" ? sep : k;
  };
  const lead = join(leads);
  const trail = join(trails);
  const atStart = () => a + trail + stem + ext;
  const atEnd = () => stem + lead + a + ext;
  const kind = ["mid", "end", "start"].reduce((best, k) => n[k] > n[best] ? k : best);
  if (kind === "start")
    return atStart();
  if (kind === "end")
    return atEnd();
  const words = [...stem.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length }));
  for (const p of topKeys(prevs)) {
    const hit = words.filter((x) => x.w === p).pop();
    if (hit)
      return stem.slice(0, hit.e) + lead + a + stem.slice(hit.e) + ext;
  }
  for (const nx of topKeys(nexts)) {
    const hit = words.find((x) => x.w === nx);
    if (hit)
      return stem.slice(0, hit.s) + a + trail + stem.slice(hit.s) + ext;
  }
  return atEnd();
};
const addToNames = (lines, add, at) => {
  let out = lines;
  for (const raw of add) {
    const a = raw.trim();
    if (!a)
      continue;
    const spots = out.filter((l) => l.toLowerCase().includes(a.toLowerCase())).map((l) => findSpot(l, a)).filter((s) => !!s);
    out = out.map((l) => l.toLowerCase().includes(a.toLowerCase()) ? l : placeOne(l, a, at, spots).replace(/\s+/g, " ").trim());
  }
  return out;
};
export const cleanLine = (line, o) => {
  let t = line;
  if (o.afterExt)
    t = t.replace(AFTER_EXT, "$1");
  if (o.sizes)
    t = t.replace(SIZE_RE, " ");
  for (const r of o.remove)
    if (r.trim())
      t = t.replace(new RegExp(escRe(r), "gi"), " ");
  for (const r of o.replace ?? [])
    if (r.from)
      t = t.replace(new RegExp(escRe(r.from), "gi"), () => r.to);
  t = t.replace(/\s+/g, " ").replace(/\s+(\.[A-Za-z0-9]{2,5})$/, "$1").replace(/^[\s\-–—|:·•]+|[\s\-–—|:·•]+$/g, "").trim();
  if (o.add?.length)
    t = addToNames([t], o.add, o.addAt ?? "auto")[0];
  return t;
};
export const cleanNames = (names, o) => {
  const cleaned = names.map((n) => cleanLine(n, { ...o, add: undefined })).filter(Boolean);
  return o.add?.length ? addToNames(cleaned, o.add, o.addAt ?? "auto") : cleaned;
};
export const editNames = (names, o) => {
  const base = { ...o, sizes: false, afterExt: false, add: undefined };
  const cleaned = names.map((n) => {
    const c = cleanLine(n, base);
    if (!c)
      return n;
    return c === n ? n : c.replace(/\.(?:\s*\.)+/g, ".");
  });
  return o.add?.length ? addToNames(cleaned, o.add, o.addAt ?? "auto") : cleaned;
};
export const suggestRemovals = (names, linkNames) => {
  if (names.length < 2)
    return [];
  const haystack = linkNames.join(`
`).toLowerCase();
  const inLinks = (chunk) => (chunk.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).some((w) => haystack.includes(w));
  const need = Math.max(2, Math.ceil(names.length * 0.6));
  const count = new Map;
  const bump = (c) => count.set(c, (count.get(c) ?? 0) + 1);
  for (const n of names) {
    const seen = new Set;
    for (const m of n.matchAll(/\[[^\]]{2,}\]|\([^)]{2,}\)/g)) {
      if (/^[[(]\s*\d+(?:[.,]\d+)?\s*[KMGT]i?B/i.test(m[0]))
        continue;
      if (/^[[(]\s*(?:19|20)\d{2}\s*[\])]$/.test(m[0]))
        continue;
      seen.add(m[0]);
    }
    seen.forEach(bump);
  }
  const out = [...count].filter(([c]) => count.get(c) >= need && !inLinks(c)).map(([c]) => c);
  const toks = names.map((n) => n.split(/\s+/));
  let k = 0;
  while (toks.every((t) => t.length > k + 1 && t[k].toLowerCase() === toks[0][k].toLowerCase()))
    k++;
  if (k > 0) {
    const chunk = toks[0].slice(0, k).join(" ");
    if (!inLinks(chunk) && !out.includes(chunk))
      out.push(chunk);
  }
  return out;
};
const ADD_SKIP = /^(?:\d{1,4}|(?:19|20)\d{2}|s\d{1,2}e\d{1,3}|\d{1,2}x\d{2,3}|e\d{1,3}|\d+(?:[.,]\d+)?[kmgt]i?b)$/i;
export const suggestAdditions = (names) => {
  if (names.length < 2)
    return [];
  const tags = new Map;
  const words = new Map;
  const bump = (m, c) => m.set(c, (m.get(c) ?? 0) + 1);
  for (const n of names) {
    const seenT = new Set;
    const seenW = new Set;
    for (const m of n.matchAll(/\[[^\]]{2,}\]|\([^)]{2,}\)/g)) {
      if (/^[[(]\s*\d+(?:[.,]\d+)?\s*[KMGT]i?B/i.test(m[0]))
        continue;
      if (/^[[(]\s*(?:19|20)\d{2}\s*[\])]$/.test(m[0]))
        continue;
      seenT.add(m[0]);
    }
    for (const w of n.split(/[\s._\-–—|·•,()[\]/]+/)) {
      const t = w.trim();
      if (t.length < 3 || ADD_SKIP.test(t))
        continue;
      if (KNOWN_EXT.test(`.${t}`))
        continue;
      seenW.add(t);
    }
    seenT.forEach((c) => bump(tags, c));
    seenW.forEach((c) => bump(words, c));
  }
  const out = new Map;
  tags.forEach((c, k) => {
    if (c < names.length)
      out.set(k, c);
  });
  words.forEach((c, k) => {
    if (c >= 2 && c < names.length)
      out.set(k, Math.max(out.get(k) ?? 0, c));
  });
  const keys = [...out.keys()];
  return [...out].filter(([k]) => !keys.some((t) => t !== k && t.toLowerCase().includes(k.toLowerCase()))).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([c]) => c);
};
export const finalName = (raw, oldName, keepExt = true, dots = "off") => {
  const n = swapSeparators(clean(raw), oldName, dots);
  if (!n)
    return "";
  if (!keepExt)
    return n;
  const hasExt = dots === "off" ? EXT.test(n) : splitExt(n, oldName)[1] !== "";
  if (hasExt)
    return n;
  const ext = oldName.match(EXT)?.[0] ?? "";
  return n + ext;
};
const norm = (s) => s.toLowerCase().replace(EXT, "").replace(/[^a-z0-9]+/g, " ").trim();
const epKey = (s) => {
  let m = s.match(/s(\d{1,2})[ ._-]?e(\d{1,3})/i);
  if (m)
    return `s${+m[1]}e${+m[2]}`;
  m = s.match(/(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?![\dp])/i);
  if (m)
    return `s${+m[1]}e${+m[2]}`;
  m = s.match(/(?:episode|ep|e)[ ._-]?(\d{1,3})(?![\dp])/i);
  return m ? `e${+m[1]}` : null;
};
const bigrams = (s) => {
  const t = s.replace(/ /g, "");
  const out = new Map;
  for (let i = 0;i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
};
const dice = (a, b) => {
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  A.forEach((n, g) => {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  });
  B.forEach((n) => total += n);
  return total ? 2 * inter / total : 0;
};
const jaccard = (a, b) => {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size)
    return 0;
  let i = 0;
  A.forEach((t) => B.has(t) && i++);
  return i / (A.size + B.size - i);
};
const lastSegment = (url) => {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(seg);
  } catch {
    return "";
  }
};
export const similarity = (want, link) => {
  const a = norm(want);
  const ea = epKey(want);
  let best = 0;
  for (const cand of [link.name, lastSegment(link.url)]) {
    if (!cand)
      continue;
    const b = norm(cand);
    const eb = epKey(cand);
    if (ea && eb && ea !== eb)
      continue;
    let sc = 0.5 * jaccard(a, b) + 0.5 * dice(a, b);
    if (ea && eb && ea === eb)
      sc = Math.min(1, sc * 0.6 + 0.45);
    best = Math.max(best, sc);
  }
  return best;
};
export const MIN_MATCH = 0.3;
export function planRenames(links, names, mode, keepExt = true, dots = "off") {
  const rows = links.map((l) => ({ url: l.url, oldName: l.name, newName: null }));
  if (mode === "order") {
    links.forEach((l, i) => {
      const n = names[i];
      if (n) {
        rows[i].newName = finalName(n, l.name, keepExt, dots) || null;
        rows[i].nameIndex = i;
      }
    });
    return { rows, unusedNames: names.slice(links.length) };
  }
  const pairs = [];
  names.forEach((n, ni) => links.forEach((l, li) => {
    const sc = similarity(n, l);
    if (sc >= MIN_MATCH)
      pairs.push({ li, ni, sc });
  }));
  pairs.sort((x, y) => y.sc - x.sc || x.ni - y.ni || x.li - y.li);
  const usedL = new Set;
  const usedN = new Set;
  for (const p of pairs) {
    if (usedL.has(p.li) || usedN.has(p.ni))
      continue;
    usedL.add(p.li);
    usedN.add(p.ni);
    rows[p.li].newName = finalName(names[p.ni], links[p.li].name, keepExt, dots) || null;
    rows[p.li].score = p.sc;
    rows[p.li].nameIndex = p.ni;
  }
  return { rows, unusedNames: names.filter((_, i) => !usedN.has(i)) };
}

const PREFIX = /^((?:[ \t│|]|├──|└──|├─|└─|[-*•][ \t])*)/;
const SIZE_SUFFIX = /\s*\(\s*\d+(?:[.,]\d+)?\s*[KMGT]?i?B\s*\)\s*$/i;
const FILE_EXT = /\.(?:mkv|mp4|avi|mov|wmv|m4v|webm|ts|flv|mpg|mpeg|srt|ass|ssa|sub|idx|vtt|nfo|txt|jpg|jpeg|png|gif|webp|bmp|torrent|zip|rar|7z|iso|sfv|md5|exe|pdf)$/i;
export function parseTree(text, base = "") {
  const stack = [];
  const seen = new Set;
  const out = [];
  const baseSegs = base.split(/[\\/]+/).filter(Boolean);
  const baseAbs = /^[\\/]/.test(base.trim());
  const emit = (segs, abs) => {
    for (let i = 1;i <= segs.length; i++) {
      const all = [...baseSegs, ...segs.slice(0, i)];
      const path = (abs || baseAbs ? "/" : "") + all.join("/");
      if (seen.has(path))
        continue;
      seen.add(path);
      out.push({ path, name: segs[i - 1], depth: i });
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim())
      continue;
    const prefix = raw.match(PREFIX)?.[1] ?? "";
    const indent = prefix.replace(/\t/g, "    ").length;
    const name = raw.slice(prefix.length).trim().replace(/^\.\//, "").replace(SIZE_SUFFIX, "").trim();
    if (!name)
      continue;
    if (FILE_EXT.test(name))
      continue;
    const abs = name.startsWith("/");
    const segs = name.replace(/\\/g, "/").split("/").map((s) => s.trim()).filter(Boolean);
    if (!segs.length)
      continue;
    while (stack.length && stack[stack.length - 1].indent >= indent)
      stack.pop();
    const parent = stack[stack.length - 1];
    const full = abs || !parent ? segs : [...parent.segs, ...segs];
    const fullAbs = abs || (parent?.abs ?? false);
    stack.push({ indent, segs: full, abs: fullAbs });
    emit(full, fullAbs);
  }
  return out;
}
const SEASON_IN_NAME = /(?:^|[\s._(\[-])(?:season|series|s)[\s._-]*(\d{1,3})(?!\d)(?![\s._]*[-–]s?\d)/i;
const SEASON_RANGE = /\b(?:seasons?|series)[\s._-]*\d{1,3}[\s._]*[-–][\s._]*\d{1,3}(?!\d|p\b|i\b)|\bs\d{1,3}[\s._]*[-–][\s._]*s\d{1,3}(?!\d)/i;
function kindOf(name) {
  const n = name.trim();
  if (/special|extras?\b|bonus/i.test(n))
    return { k: "special" };
  if (SEASON_RANGE.test(n))
    return { k: "show" };
  const m = n.match(SEASON_IN_NAME);
  if (m) {
    const num = parseInt(m[1], 10);
    return num === 0 ? { k: "special" } : { k: "season", n: num };
  }
  if (/^shorts?\b/i.test(n))
    return { k: "shorts" };
  return { k: "show" };
}
const MARKER = /\b(?:s\d{1,4}[\s._-]*e\d{1,4}|\d{1,2}x\d{1,4}|(?:s|season)[\s._-]*\d{1,4})(?!\d)/i;
const STOP = new Set(["the", "a", "an", "of", "and", "complete", "series"]);
const tokens = (s) => s.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));
function seasonOfTitle(t) {
  let m = t.match(/s(\d{1,4})[\s._-]*e\d{1,4}/i);
  if (m)
    return parseInt(m[1], 10);
  m = t.match(/\b(\d{1,2})x\d{1,3}\b/i);
  if (m)
    return parseInt(m[1], 10);
  m = t.match(/\b(?:s|season)[\s._-]*(\d{1,4})(?!\d)/i);
  return m ? parseInt(m[1], 10) : null;
}
const isSubset = (a, b) => a.length > 0 && a.every((x) => b.has(x));
const folderTokens = (name) => tokens(name.split(/\b(?:seasons?|complete|s\d{1,2}|\d{3,4}p)\b/i)[0] ?? name);
const decodeUrl = (u) => {
  let t = u;
  for (let i = 0;i < 2; i++) {
    try {
      const d = decodeURIComponent(t);
      if (d === t)
        break;
      t = d;
    } catch {
      break;
    }
  }
  return t;
};
function renumberSeason(name, n) {
  const m = SEASON_IN_NAME.exec(name);
  if (!m)
    return null;
  const digits = m[1];
  const at = m.index + m[0].length - digits.length;
  const next = String(n).padStart(digits.length, "0");
  return name.slice(0, at) + next + name.slice(at + digits.length);
}
const sibling = (path, name) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? name : `${path.slice(0, i)}/${name}`;
};
export function matchLinksToTree(links, nodes) {
  const assignments = {};
  const unmatched = [];
  const synth = new Set;
  const shows = nodes.filter((n) => kindOf(n.name).k === "show");
  const showTok = new Map(shows.map((n) => [n.path, folderTokens(n.name)]));
  const namedSeasons = [];
  const namedSpecials = [];
  for (const n of nodes) {
    const k = kindOf(n.name);
    if (k.k === "season") {
      const ft = folderTokens(n.name);
      if (ft.length)
        namedSeasons.push({ n, season: k.n, ft });
    } else if (k.k === "special") {
      const ft = folderTokens(n.name.replace(/specials?|extras?|bonus/gi, " "));
      if (ft.length)
        namedSpecials.push({ n, ft });
    }
  }
  const childrenOf = (p) => nodes.filter((n) => n.depth === p.depth + 1 && n.path.startsWith(p.path + "/") && n.path.slice(p.path.length + 1).indexOf("/") === -1);
  for (const { url, title, names } of links) {
    const nameList = Array.from(new Set([title, ...names ?? []].filter(Boolean)));
    const urlText = decodeUrl(url);
    const linkSeason = nameList.map(seasonOfTitle).find((x) => x !== null) ?? seasonOfTitle(urlText) ?? null;
    const specialLink = linkSeason === 0 || nameList.some((t) => /\bspecials?\b|\bova\b/i.test(t));
    let namedHit = null;
    let namedScore = 0;
    for (const text of [...nameList, urlText]) {
      const ws = new Set(tokens(text));
      if (specialLink) {
        for (const c of namedSpecials)
          if (isSubset(c.ft, ws) && c.ft.length > namedScore) {
            namedHit = c.n;
            namedScore = c.ft.length;
          }
      } else if (linkSeason !== null) {
        for (const c of namedSeasons)
          if (c.season === linkSeason && isSubset(c.ft, ws) && c.ft.length > namedScore) {
            namedHit = c.n;
            namedScore = c.ft.length;
          }
      }
      if (namedHit)
        break;
    }
    if (namedHit) {
      assignments[url] = namedHit.path;
      continue;
    }
    const matchText = (text, useMarker) => {
      const tok = new Set(tokens(text));
      const marker = useMarker ? text.match(MARKER) : null;
      const showPart = tokens(marker?.index !== undefined ? text.slice(0, marker.index) : "");
      let hit = null;
      let score = 0;
      for (const s of shows) {
        const ft = showTok.get(s.path);
        let sc = 0;
        if (isSubset(ft, tok))
          sc = ft.length;
        else if (useMarker && isSubset(showPart, new Set(ft)))
          sc = showPart.length - 0.1;
        if (sc > score) {
          hit = s;
          score = sc;
        }
      }
      return hit;
    };
    let best = null;
    let source = title;
    for (const nm of nameList) {
      const hit = matchText(nm, true);
      if (hit) {
        best = hit;
        source = nm;
        break;
      }
    }
    if (!best) {
      best = matchText(urlText, false);
      source = urlText;
    }
    if (!best) {
      if (linkSeason !== null && linkSeason > 0 && !specialLink) {
        let model = null;
        for (const text of [...nameList, urlText]) {
          const ws = new Set(tokens(text));
          for (const c of namedSeasons)
            if (isSubset(c.ft, ws) && (!model || c.ft.length > model.ft.length))
              model = c;
          if (model)
            break;
        }
        const nm = model ? renumberSeason(model.n.name, linkSeason) : null;
        if (model && nm) {
          const p = sibling(model.n.path, nm);
          synth.add(p);
          assignments[url] = p;
          continue;
        }
      }
      unmatched.push(url);
      continue;
    }
    const kids = childrenOf(best).map((n) => ({ n, kind: kindOf(n.name) }));
    const special = kids.find((x) => x.kind.k === "special")?.n;
    const shorts = kids.find((x) => x.kind.k === "shorts")?.n;
    const season = seasonOfTitle(source) ?? [...nameList, urlText].map(seasonOfTitle).find((x) => x !== null) ?? null;
    const isSpecial = season === 0 || nameList.some((t) => /\bspecials?\b|\bova\b/i.test(t));
    const isShort = nameList.some((t) => /\bshorts?\b/i.test(t));
    let target;
    if (isSpecial)
      target = special;
    else if (isShort && shorts)
      target = shorts;
    else if (season !== null && season > 0) {
      target = kids.find((x) => x.kind.k === "season" && x.kind.n === season)?.n;
      const model = kids.find((x) => x.kind.k === "season");
      const nm = !target && model ? renumberSeason(model.n.name, season) : null;
      if (model && nm) {
        const p = sibling(model.n.path, nm);
        synth.add(p);
        assignments[url] = p;
        continue;
      }
    }
    assignments[url] = (target ?? special ?? best).path;
  }
  const used = new Set(Object.values(assignments));
  const parents = new Set(nodes.map((n) => n.path.slice(0, Math.max(0, n.path.lastIndexOf("/")))));
  const folders = Array.from(new Set([
    ...nodes.filter((n) => used.has(n.path) || !parents.has(n.path)).map((n) => n.path),
    ...synth
  ]));
  return { assignments, unmatched, folders };
}
export const showFolders = (nodes) => nodes.filter((n) => kindOf(n.name).k === "show").map((n) => n.path);
export const DEFAULT_SUGGEST = { dots: true, stripEpisode: true, stripTitle: true };
const VIDEO_EXT = /\.(?:mkv|mp4|avi|mov|wmv|m4v|webm|ts|flv|mpg|mpeg)$/i;
const EP_MARKER = /\bs(\d{1,4})[\s._-]*e\d{1,4}(?:[\s._-]*(?:e|-e?)\d{1,4})*|\b(\d{1,2})x\d{1,4}\b/i;
const TECH_TAG = /\b(?:2160p|1080p|720p|576p|480p|4k|uhd|web[\s._-]?(?:dl|rip)|web(?=[\s._-]+(?:x26[45]|h[\s._]?26[45]|hevc|avc|aac|ac3|ddp?[\s._]?\d|dts|\d{3,4}p))|bluray|bdrip|brrip|hdtv|dvdrip|hdrip|x26[45]|h[\s._]?26[45]|hevc|avc|remux|amzn|atvp|dsnp|hmax|hulu|nf|pcok|ddp?[\s._]?\d|aac|ac3|dts|atmos|repack|proper)\b/i;
const trimSep = (t) => t.replace(/^[\s._-]+|[\s._-]+$/g, "");
export function suggestFolder(names, rules = DEFAULT_SUGGEST) {
  for (const raw of names) {
    const name = raw.replace(VIDEO_EXT, "").trim();
    const m = name.match(EP_MARKER);
    if (!m || m.index === undefined)
      continue;
    const season = parseInt(m[1] ?? m[2] ?? "", 10);
    if (!Number.isFinite(season))
      continue;
    const hasSpaces = /\s/.test(name);
    const sep = hasSpaces ? " " : name.includes(".") ? "." : name.includes("_") ? "_" : " ";
    const before = trimSep(name.slice(0, m.index));
    const afterRaw = name.slice(m.index + m[0].length);
    const tag = afterRaw.match(TECH_TAG);
    const cut = tag?.index ?? afterRaw.length;
    const title = trimSep(afterRaw.slice(0, cut));
    const rest = trimSep(afterRaw.slice(cut));
    const marker = rules.stripEpisode ? `S${String(season).padStart(2, "0")}` : m[0];
    let out = [before, marker, rules.stripTitle ? "" : title, rest].filter(Boolean).join(sep);
    if (hasSpaces && rules.dots)
      out = out.replace(/\s+/g, ".");
    out = out.replace(/[\\/:*?"<>|]/g, "").replace(/\.{2,}/g, ".");
    if (out)
      return out;
  }
  return null;
}


// Keeps the leading "/" of absolute paths ("content/drive/..." gets its slash back).
export const normFolder = (raw) => {
  let d = (raw ?? "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (/^(?:content|drive)(?:\/|$)/i.test(d)) d = "/" + d;
  return d;
};
