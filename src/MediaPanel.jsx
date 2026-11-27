import { createElement as h } from "react";
import { MD_VIDEO, MD_SUB, mdAutoSubs, mdClamp, mdOutName, mdValidDt } from "./lib/media.js";

// FFmpeg mux & audio + "Set modified date" (ported from Link Nest).
// items = the picked items; edit(list, fn) patches items; media / onMedia = global options.
// (Written with createElement so it needs no JSX transform of its own.)
export default function MediaPanel({ items, keyOf, media: M, onMedia, edit, notify }) {
  const kv = (i) => ({ key: keyOf(i), name: i.name });
  const vids = items.filter((i) => i.isDir || MD_VIDEO.test(i.name));
  const subs = items.filter((i) => !i.isDir && MD_SUB.test(i.name));
  const auto = mdAutoSubs(items.filter((i) => !i.isDir && MD_VIDEO.test(i.name)).map(kv), subs.map(kv));
  const nAuto = Object.keys(auto).length;
  const setFf = (list, patch, on) => { edit(list, (x) => ({ ff: { ...x.ff, ...patch } })); if (on) onMedia({ ffOn: true }); };
  const nFf = vids.filter((i) => i.ff && i.ff.on).length;
  const nDt = items.filter((i) => i.dt).length;
  const pl = (n) => (n === 1 ? "" : "s");

  const chk = (text, checked, onChange) =>
    h("label", { className: "chkrow" }, h("input", { type: "checkbox", checked: !!checked, onChange: (e) => onChange(e.target.checked) }), h("span", null, text));
  const btn = (text, onClick, cls) => h("button", { type: "button", className: cls || "", onClick }, text);

  const ffRow = (i) => {
    const c = i.ff || {};
    const k = keyOf(i);
    const sub = i.isDir ? "" : c.sub === undefined ? auto[k] || "" : c.sub;
    const keep = !sub && !!c.boost;
    const dbv = c.db === undefined ? M.db : c.db;
    return h("div", { className: "sub-box", key: i.dir + i.name },
      h("label", { className: "chkrow" },
        h("input", { type: "checkbox", checked: !!c.on, onChange: (e) => setFf([i], { on: e.target.checked }, e.target.checked) }),
        h("span", { style: { wordBreak: "break-all" } }, (i.isDir ? "📁 " : "") + i.name,
          !i.isDir && h("small", { style: { display: "block", fontWeight: 700 } }, "→ " + mdOutName(i.name, keep)))),
      h("div", { className: "row" },
        !i.isDir && h("select", { value: sub, onChange: (e) => setFf([i], { sub: e.target.value, ...(e.target.value ? { on: true } : {}) }, !!e.target.value) },
          h("option", { value: "" }, "No subtitle (video only)"),
          subs.map((s) => { const sk = keyOf(s); return h("option", { key: sk, value: sk }, (sk === auto[k] ? "★ " : "") + s.name + (sk === auto[k] ? " (match)" : "")); })),
        h("button", { type: "button", className: c.boost ? "go" : "", style: { flex: "0 0 auto", width: "auto" },
          onClick: () => setFf([i], { boost: !c.boost, db: dbv, ...(!c.boost ? { on: true } : {}) }, !c.boost) }, c.boost ? "🔊 +" + dbv + "dB" : "🔈 Audio +dB"),
        c.boost && h("input", { type: "number", min: -60, max: 60, step: 1, value: dbv, style: { flex: "0 0 70px" },
          onChange: (e) => setFf([i], { db: mdClamp(e.target.value, M.db) }) })));
  };

  return h("div", null,
    h("details", { className: "box tool" },
      h("summary", null, "🎬 FFmpeg mux & audio ", h("small", null, M.ffOn && nFf ? `${nFf} ready` : `${vids.length} video${pl(vids.length)}${nAuto ? ` · ${nAuto} matched` : ""}`)),
      h("small", { className: "note" }, "After the downloads: muxes the matching subtitle into the video and/or boosts the audio, saving an .mkv (boost only keeps the original name). Pick the .srt files too. Folders: every video inside gets the boost / remux (no subtitle)."),
      chk("Include the ffmpeg step in the script / list", M.ffOn, (v) => onMedia({ ffOn: v })),
      h("div", { className: "row" }, h("span", { style: { flex: "0 0 auto" } }, "Default boost (dB)"),
        h("input", { type: "number", min: -60, max: 60, step: 1, value: M.db, style: { flex: "0 0 80px" }, onChange: (e) => onMedia({ db: mdClamp(e.target.value, 12) }) })),
      chk("Delete the source video / .srt after muxing", M.del, (v) => onMedia({ del: v })),
      h("div", { className: "row" },
        btn("Auto-match SRTs", () => {
          const hit = items.filter((i) => !i.isDir && auto[keyOf(i)]);
          if (!hit.length) { notify("No matching subtitles found - pick pairs manually"); return; }
          setFf(hit, { on: true, sub: undefined }, true);
          notify(`Matched ${hit.length} video + subtitle pair${pl(hit.length)}`);
        }),
        btn("Tick all", () => setFf(vids, { on: true }, true)),
        btn("None", () => setFf(vids, { on: false }, false))),
      h("div", { className: "row" },
        btn("Boost all ticked (or all)", () => {
          const any = vids.some((i) => i.ff && i.ff.on);
          setFf(vids.filter((i) => !any || (i.ff && i.ff.on)), { on: true, boost: true, db: M.db }, true);
        }),
        btn("Clear boost", () => setFf(vids, { boost: false }, false))),
      !vids.length ? h("small", null, "Select video items (.mp4 / .mkv …) or folders first.") : vids.map(ffRow)),

    h("details", { className: "box tool" },
      h("summary", null, "🕒 Set modified date ", h("small", null, M.dateOn && nDt && mdValidDt(M.datetime) ? `${nDt} item${pl(nDt)} · ${M.datetime.replace("T", " ")}` : `${items.length} item${pl(items.length)}`)),
      h("small", { className: "note" }, "After the downloads (and ffmpeg) every ticked item gets this modified date. Uses the notebook clock timezone (UTC on Colab)."),
      h("input", { type: "datetime-local", value: M.datetime, onChange: (e) => onMedia({ datetime: e.target.value }) }),
      chk("Include the date step in the script / list", M.dateOn, (v) => onMedia({ dateOn: v })),
      h("div", { className: "row" },
        btn("Tick all", () => { edit(items, () => ({ dt: true })); onMedia({ dateOn: true }); }),
        btn("None", () => edit(items, () => ({ dt: undefined })))),
      !items.length ? h("small", null, "Select items first.") : items.map((i) =>
        h("label", { className: "chkrow", key: i.dir + i.name },
          h("input", { type: "checkbox", checked: !!i.dt, onChange: (e) => { edit([i], () => ({ dt: e.target.checked ? true : undefined })); if (e.target.checked) onMedia({ dateOn: true }); } }),
          h("span", { style: { wordBreak: "break-all" } }, (i.isDir ? "📁 " : "") + i.name)))));
}
