import { useEffect, useMemo, useState } from "react";
import { cleanNames, editNames, parseNameList, planRenames, suggestAdditions, suggestRemovals } from "./lib/core.js";

// Renamer (ported from Link Nest). Pairs a pasted list of names with the selected files, either in
// order or by closest match, or (nothing pasted) edits the files' CURRENT names.
const MODES = [
  ["order", "In order", "1st name → 1st selected file, 2nd → 2nd …"],
  ["match", "Closest match", "Each name goes to the most similar file (episode numbers must agree)"],
];
const DOT_MODES = [
  ["off", "As pasted", "Use the names exactly as pasted"],
  ["dots-to-spaces", "Dots → spaces", "Show.S01E01.Title.mkv → Show S01E01 Title.mkv"],
  ["spaces-to-dots", "Spaces → dots", "Show S01E01 Title.mkv → Show.S01E01.Title.mkv"],
];
const ADD_AT = [
  ["auto", "Auto", "Copy the spot it already has on the other lines"],
  ["end", "At the end", "End of the name, before the extension"],
  ["start", "At the start", "Front of the name"],
];

const Seg = ({ options, value, onPick }) => (
  <div className="seg">
    {options.map(([k, label, tip]) => (
      <button key={k} type="button" title={tip} className={value === k ? "on" : ""} onClick={() => onPick(k)}>{label}</button>
    ))}
  </div>
);

export default function RenamePanel({ links, renamedCount, onApply, onReset, notify, storeKey = "gb_rename_draft" }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("order");
  const [keepExt, setKeepExt] = useState(true);
  const [dots, setDots] = useState("off");
  const [addText, setAddText] = useState("");
  const [addAt, setAddAt] = useState("auto");
  const [ignoreSizes, setIgnoreSizes] = useState(true);
  const [afterExt, setAfterExt] = useState(true);
  const [removeText, setRemoveText] = useState("");
  const [swaps, setSwaps] = useState([{ from: "", to: "" }]);
  const setSwap = (i, k, v) => setSwaps((a) => a.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  // pasted names and every setting survive a refresh (applied renames live on the items)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem(storeKey) || "{}");
      if (typeof j.text === "string") setText(j.text);
      if (j.mode === "order" || j.mode === "match") setMode(j.mode);
      if (typeof j.keepExt === "boolean") setKeepExt(j.keepExt);
      if (["off", "dots-to-spaces", "spaces-to-dots"].includes(j.dots)) setDots(j.dots);
      if (typeof j.ignoreSizes === "boolean") setIgnoreSizes(j.ignoreSizes);
      if (typeof j.afterExt === "boolean") setAfterExt(j.afterExt);
      if (typeof j.removeText === "string") setRemoveText(j.removeText);
      if (typeof j.addText === "string") setAddText(j.addText);
      if (["auto", "end", "start"].includes(j.addAt)) setAddAt(j.addAt);
      if (Array.isArray(j.swaps) && j.swaps.length)
        setSwaps(j.swaps.filter((r) => r && typeof r === "object").map((r) => ({ from: typeof r.from === "string" ? r.from : "", to: typeof r.to === "string" ? r.to : "" })));
    } catch { /* ignore broken storage */ }
    setReady(true);
  }, [storeKey]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storeKey, JSON.stringify({ text, mode, keepExt, dots, ignoreSizes, afterExt, removeText, addText, addAt, swaps })); } catch { /* ignore */ }
  }, [ready, storeKey, text, mode, keepExt, dots, ignoreSizes, afterExt, removeText, addText, addAt, swaps]);

  const pastedNames = useMemo(() => parseNameList(text), [text]);
  const editing = pastedNames.length === 0; // nothing pasted: edit the CURRENT names
  const currentNames = useMemo(() => links.map((l) => l.name), [links]);
  const rawNames = editing ? currentNames : pastedNames;
  const removeList = useMemo(() => removeText.split(/\r?\n/).filter((l) => l.trim() !== ""), [removeText]);
  const addList = useMemo(() => addText.split(/\r?\n/).filter((l) => l.trim() !== ""), [addText]);
  const hitLines = useMemo(() => rawNames.filter((n) => removeList.some((r) => n.toLowerCase().includes(r.toLowerCase()))).length, [rawNames, removeList]);
  const clean = editing ? editNames : cleanNames;
  const names = useMemo(
    () => clean(rawNames, { sizes: ignoreSizes, afterExt, remove: removeList, replace: swaps, add: addList, addAt }),
    [clean, rawNames, ignoreSizes, afterExt, removeList, swaps, addList, addAt]
  );
  const addedCount = useMemo(() => {
    if (!addList.length) return 0;
    const plain = clean(rawNames, { sizes: ignoreSizes, afterExt, remove: removeList, replace: swaps });
    return plain.filter((n, i) => n !== names[i]).length;
  }, [clean, rawNames, ignoreSizes, afterExt, removeList, swaps, addList, names]);

  // one shared list of chips, offered under BOTH "remove" and "add"
  const chips = useMemo(() => {
    const base = clean(rawNames, { sizes: ignoreSizes, afterExt, remove: [] });
    const junk = editing ? suggestRemovals(base, []).filter((c) => /^[[(]/.test(c)) : suggestRemovals(base, links.map((l) => l.name));
    const seen = new Set();
    return [...junk, ...suggestAdditions(base)].filter((c) => { const k = c.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [clean, editing, rawNames, ignoreSizes, afterExt, links]);
  const removeChips = useMemo(() => { const have = new Set(removeList.map((r) => r.toLowerCase())); return chips.filter((c) => !have.has(c.toLowerCase())); }, [chips, removeList]);
  const addChips = useMemo(() => { const have = new Set(addList.map((r) => r.toLowerCase())); return chips.filter((c) => !have.has(c.toLowerCase())); }, [chips, addList]);

  const plan = useMemo(() => planRenames(links, names, editing ? "order" : mode, keepExt, dots), [links, names, mode, keepExt, dots, editing]);
  const changes = plan.rows.filter((r) => r.newName && r.newName !== r.oldName);
  const unassigned = plan.rows.filter((r) => !r.newName).length;
  const previewRows = editing ? changes : plan.rows;
  const showPreview = editing ? changes.length > 0 : names.length > 0;
  const noun = editing ? "name" : "pasted line";
  const s = (n) => (n === 1 ? "" : "s");

  const apply = () => {
    if (!changes.length) return notify && notify("Nothing to rename");
    onApply(Object.fromEntries(changes.map((r) => [r.url, r.newName])));
    notify && notify(`Renamed ${changes.length} file${s(changes.length)}`);
    setText(""); setRemoveText(""); setAddText(""); setSwaps([{ from: "", to: "" }]);
  };
  const addChip = (set) => (c) => set((t) => (t.trim() ? t.replace(/\s*$/, "\n") : "") + c);

  return (
    <details className="box tool">
      <summary>✎ Renamer <small>{links.length} file{s(links.length)} selected{renamedCount ? ` · ${renamedCount} renamed` : ""}</small></summary>
      <textarea className="mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        placeholder={"Paste the new file names, one per line (or leave empty to edit the current names below)\nKiff - S01E01 - Thirst.mkv\nKiff - S01E02 - Fourth Bath.mkv"} />

      {editing
        ? <small className="note"><b>Editing current names.</b> Nothing is pasted, so the options below change the names of the {links.length} selected file{s(links.length)}. (Folders can't be renamed.)</small>
        : <Seg options={MODES} value={mode} onPick={setMode} />}

      <div className="lbl">Dots &amp; spaces</div>
      <Seg options={DOT_MODES} value={dots} onPick={setDots} />
      <small>The last dot (file extension) is never changed</small>

      <label className="chkrow"><input type="checkbox" checked={keepExt} onChange={(e) => setKeepExt(e.target.checked)} /><span>Keep file extension <small>(names pasted without .mkv / .mp4 get the old one)</small></span></label>

      <div className="sub-box">
        <div className="lbl">{editing ? "Edit names" : "Clean pasted lines"}</div>
        {!editing && (
          <>
            <label className="chkrow"><input type="checkbox" checked={ignoreSizes} onChange={(e) => setIgnoreSizes(e.target.checked)} /><span>Ignore file sizes <small>(1.2 GB, [700MB] …)</small></span></label>
            <label className="chkrow"><input type="checkbox" checked={afterExt} onChange={(e) => setAfterExt(e.target.checked)} /><span>Drop anything after the extension <small>(.mkv …)</small></span></label>
          </>
        )}
        <div className="lbl">Text to remove from each line</div>
        <textarea className="mono" rows={2} value={removeText} onChange={(e) => setRemoveText(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          placeholder={"Type text to remove, one per line\n[SomeSite.com]\nDownload:"} />
        {removeList.length > 0 && <small>Found in {hitLines} of {rawNames.length} {noun}{s(rawNames.length)} · removed everywhere it appears</small>}
        {removeChips.length > 0 && (<><small>Tap to remove from every line:</small><div className="chips">{removeChips.map((c) => <button key={c} type="button" className="chip" onClick={() => addChip(setRemoveText)(c)}>+ {c}</button>)}</div></>)}

        <div className="lbl">Text to add to lines missing it</div>
        <textarea className="mono" rows={2} value={addText} onChange={(e) => setAddText(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          placeholder={"Type text to add, one per line\n[GRP]\nREPACK"} />
        <Seg options={ADD_AT} value={addAt} onPick={setAddAt} />
        <small>Lines that already have it are left alone · Auto puts it where the other lines have it, and swaps the same kind of thing (720p ↔ 1080p, H.264 → x265, REPACK ↔ PROPER, a lone [tag], -Group) instead of adding a second one</small>
        {addList.length > 0 && <small>Added to {addedCount} of {rawNames.length} {noun}{s(rawNames.length)}</small>}
        {addChips.length > 0 && (<><small>Tap to add where it is missing:</small><div className="chips">{addChips.map((c) => <button key={c} type="button" className="chip" onClick={() => addChip(setAddText)(c)}>+ {c}</button>)}</div></>)}

        <div className="lbl">Replace text</div>
        {swaps.map((r, i) => (
          <div className="row" key={i}>
            <input className="mono" value={r.from} onChange={(e) => setSwap(i, "from", e.target.value)} spellCheck={false} placeholder="1080p" aria-label="Text to find" />
            <span style={{ flex: "0 0 auto" }}>→</span>
            <input className="mono" value={r.to} onChange={(e) => setSwap(i, "to", e.target.value)} spellCheck={false} placeholder="720p" aria-label="Replace with" />
            <button type="button" style={{ flex: "0 0 36px" }} aria-label="Remove this replacement" onClick={() => setSwaps((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : [{ from: "", to: "" }]))}>✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setSwaps((a) => [...a, { from: "", to: "" }])}>+ Add replacement</button>
      </div>

      {showPreview && (
        <div className="sub-box">
          <div className="lbl">
            Preview · {changes.length} to rename{editing ? ` of ${links.length}` : ""}
            {!editing && unassigned ? ` · ${unassigned} file${s(unassigned)} unchanged` : ""}
            {plan.unusedNames.length ? ` · ${plan.unusedNames.length} name${s(plan.unusedNames.length)} unused` : ""}
          </div>
          <ul className="pv">
            {previewRows.map((r) => (
              <li key={r.url}>
                <div className="old">{r.oldName}</div>
                {r.newName
                  ? <div className="new">→ {r.newName}{r.score !== undefined && <small> ({Math.round(r.score * 100)}%)</small>}</div>
                  : <div className="old">— no name assigned</div>}
              </li>
            ))}
          </ul>
          {plan.unusedNames.length > 0 && <small>Unused: {plan.unusedNames.slice(0, 5).join(" · ")}{plan.unusedNames.length > 5 ? " …" : ""}</small>}
        </div>
      )}

      <div className="row">
        <button type="button" className="go" disabled={!changes.length} onClick={apply}>Rename {changes.length || ""} file{s(changes.length)}</button>
        <button type="button" disabled={!renamedCount} onClick={() => onReset(links.map((l) => l.url))} title="Go back to the original names for the selected files">↶ Reset names</button>
      </div>
    </details>
  );
}
