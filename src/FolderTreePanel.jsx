import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SUGGEST, matchLinksToTree, normFolder, parseTree, showFolders, suggestFolder } from "./lib/core.js";

// Folder tree (ported from Link Nest). Paste a folder tree, match the selected items to folders
// (show folder -> season folder, S00 / leftovers -> Specials), or name folders from file names.
// `plan.assignments[key] = { folder, forced }`. The generated script creates missing folders.

// one-line text field that wraps long text onto more lines instead of scrolling sideways
function WrapInput({ value, onChange, ariaLabel, dim }) {
  const ref = useRef(null);
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea ref={ref} rows={1} value={value} aria-label={ariaLabel} spellCheck={false}
      style={{ resize: "none", overflow: "hidden", wordBreak: "break-all", opacity: dim ? 0.5 : 1, minHeight: 0 }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
  );
}

const RULES = [
  ["dots", "Spaces → dots (only when the file names have spaces)"],
  ["stripEpisode", "Remove episode number (S01E01 → S01)"],
  ["stripTitle", "Remove episode title"],
];

export default function FolderTreePanel({ links, plan, onChange, notify, storeKey = "gb_tree" }) {
  const [text, setText] = useState("");
  const [base, setBase] = useState("");
  const [manual, setManual] = useState("");
  const [parent, setParent] = useState("");
  const [rules, setRules] = useState(DEFAULT_SUGGEST);
  const [ready, setReady] = useState(false);
  const say = (m) => notify && notify(m);
  const s = (n) => (n === 1 ? "" : "s");

  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem(storeKey) || "{}");
      if (typeof j.text === "string") setText(j.text);
      if (typeof j.base === "string") setBase(j.base);
      if (j.rules && typeof j.rules === "object") setRules({ ...DEFAULT_SUGGEST, ...j.rules });
    } catch { /* ignore */ }
    setReady(true);
  }, [storeKey]);
  useEffect(() => { if (ready) try { localStorage.setItem(storeKey, JSON.stringify({ text, base, rules })); } catch { /* ignore */ } }, [ready, storeKey, text, base, rules]);

  const nodes = useMemo(() => parseTree(text, base), [text, base]);
  const result = useMemo(() => {
    const r = matchLinksToTree(links, nodes);
    const assignments = { ...r.assignments };
    for (const u of Object.keys(assignments)) if (plan.assignments[u]?.forced) delete assignments[u]; // hand-forced links are never touched
    return { ...r, assignments };
  }, [links, nodes, plan.assignments]);
  const perFolder = useMemo(() => { const m = new Map(); for (const f of Object.values(result.assignments)) m.set(f, (m.get(f) ?? 0) + 1); return [...m.entries()]; }, [result]);
  const matched = Object.keys(result.assignments).length;

  // links the tree did not match (and not forced): build a folder name from the file name
  const suggested = useMemo(() => {
    const out = {};
    const prefix = base.trim().replace(/[\\/]+$/, "");
    for (const l of links) {
      if (l.url in result.assignments || plan.assignments[l.url]?.forced) continue;
      const sg = suggestFolder([l.title, ...(l.names ?? [])], rules);
      if (sg) out[l.url] = normFolder(prefix ? `${prefix}/${sg}` : sg);
    }
    return out;
  }, [links, result, plan.assignments, rules, base]);
  const suggestedFolders = useMemo(() => { const m = new Map(); for (const f of Object.values(suggested)) m.set(f, (m.get(f) ?? 0) + 1); return [...m.entries()]; }, [suggested]);

  // unticks + renames are only valid for the set of suggested names they were made against
  const suggestedSig = useMemo(() => JSON.stringify(suggestedFolders.map(([f]) => f).sort()), [suggestedFolders]);
  const [edits, setEdits] = useState({ sig: "", skipped: new Set(), renames: {} });
  const cur = edits.sig === suggestedSig ? edits : { sig: suggestedSig, skipped: new Set(), renames: {} };
  const { skipped, renames } = cur;
  const setSkippedFor = (f, on) => { const nx = new Set(skipped); on ? nx.add(f) : nx.delete(f); setEdits({ sig: suggestedSig, skipped: nx, renames }); };
  const setRenameFor = (f, v) => setEdits({ sig: suggestedSig, skipped, renames: { ...renames, [f]: v } });

  const chosen = useMemo(() => {
    const out = {};
    for (const [u, orig] of Object.entries(suggested)) { if (skipped.has(orig)) continue; out[u] = normFolder(renames[orig]?.trim() || orig); }
    return out;
  }, [suggested, skipped, renames]);
  const chosenCount = Object.keys(chosen).length;
  const forcedCount = links.filter((l) => plan.assignments[l.url]?.forced).length;

  const apply = () => {
    if (!matched) return say("No files matched the tree");
    const assignments = { ...plan.assignments };
    for (const [u, folder] of Object.entries(result.assignments)) assignments[u] = { ...assignments[u], folder };
    onChange({ ...plan, assignments });
    say(`Assigned ${matched} file${s(matched)} to folders`);
  };
  const applyAllTo = (f) => {
    const folder = normFolder(renames[f]?.trim() || f);
    const assignments = { ...plan.assignments };
    let n = 0;
    for (const l of links) { if (plan.assignments[l.url]?.forced) continue; assignments[l.url] = { ...assignments[l.url], folder, forced: true }; n++; }
    if (!n) return say("No files to move");
    onChange({ ...plan, assignments });
    say(`Put ${n} file${s(n)} into ${folder}`);
  };
  const applySuggested = () => {
    const entries = Object.entries(chosen);
    if (!entries.length) return say("No folders ticked");
    const assignments = { ...plan.assignments };
    for (const [u, folder] of entries) assignments[u] = { ...assignments[u], folder };
    onChange({ ...plan, assignments });
    say(`Named folders for ${entries.length} file${s(entries.length)} from file names`);
  };
  const clearAssigned = () => {
    const assignments = { ...plan.assignments };
    for (const u of Object.keys(result.assignments)) if (assignments[u]) assignments[u] = { ...assignments[u], folder: undefined };
    onChange({ ...plan, assignments });
    say("Cleared folders for matched files");
  };
  const forceAssign = (clear = false) => {
    const folder = manual.trim();
    if (!clear && !folder) return;
    if (!links.length) return say("Select some files first");
    const assignments = { ...plan.assignments };
    for (const l of links)
      assignments[l.url] = clear ? { ...assignments[l.url], folder: undefined, forced: undefined } : { ...assignments[l.url], folder, forced: true };
    onChange({ ...plan, assignments });
    say(`${clear ? "Unforced" : "Forced folder for"} ${links.length} file${s(links.length)}`);
  };
  // "Show/Season 1" -> "Big/Show/Season 1" (after the base path, when there is one)
  const addParent = () => {
    let p = parent.trim().replace(/^[\\/]+|[\\/]+$/g, "");
    if (!p) return;
    const b = base.trim().replace(/[\\/]+$/, "");
    const bNorm = b.replace(/^[\\/]+/, "");
    if (bNorm && p.startsWith(bNorm + "/")) p = p.slice(bNorm.length + 1);
    const assignments = { ...plan.assignments };
    let n = 0;
    for (const l of links) {
      const f = assignments[l.url]?.folder;
      if (!f) continue;
      let head, tail;
      if (b && f.startsWith(b + "/")) { head = `${b}/${p}/`; tail = f.slice(b.length + 1); }
      else if (f.startsWith("/")) { head = `/${p}/`; tail = f.replace(/^\/+/, ""); }
      else { head = `${p}/`; tail = f; }
      if (f.startsWith(head)) continue; // already wrapped
      assignments[l.url] = { ...assignments[l.url], folder: head + tail };
      n++;
    }
    if (!n) return say("Selected files have no folder to wrap");
    onChange({ ...plan, assignments });
    say(`Added "${p}" around the folder of ${n} file${s(n)}`);
  };

  const folderSelect = (label, onPick) => (
    <select aria-label={label} value="" disabled={!result.folders.length} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{result.folders.length ? "Pick a folder from the tree…" : "No folders in the tree yet"}</option>
      {result.folders.map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  );

  return (
    <details className="box tool">
      <summary>🗂 Folder tree {(nodes.length > 0 || forcedCount > 0) && <small>{nodes.length > 0 && `· ${nodes.length} folders · ${matched}/${links.length} matched`}{forcedCount > 0 && ` · ${forcedCount} forced`}</small>}</summary>

      <div className="lbl">Base path (optional)</div>
      <input value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} placeholder="/content/drive/MyDrive" />
      <div className="lbl">Paste tree</div>
      <textarea className="mono" style={{ height: 140 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        placeholder={"Show Name (2011)\n\tSeason 1\n\tSeason 2\n\tSpecials\n\nor  /Cartoons/Show Name/Season 1"} />

      {nodes.length > 0 && (
        <div className="sub-box">
          {perFolder.length
            ? <ul className="pv">{perFolder.map(([f, n]) => <li key={f} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ wordBreak: "break-all" }}>{f}</span><b>{n}</b></li>)}</ul>
            : <small>No files match these folders yet.</small>}
          <small style={{ display: "block", wordBreak: "break-all" }}>Show folders found: {showFolders(nodes).join(" | ") || "none"}</small>
          {result.unmatched.length > 0 && (
            <>
              <small className="bad" style={{ display: "block", wordBreak: "break-all" }}>Unmatched: {links.filter((l) => result.unmatched.includes(l.url)).slice(0, 3).map((l) => l.title).join(" | ")}</small>
              <small className="bad"><b>{result.unmatched.length} file{s(result.unmatched.length)} matched no folder and keep their current folder.</b></small>
            </>
          )}
        </div>
      )}

      <div className="row">
        <button type="button" className="go" disabled={!matched} onClick={apply}>Assign {matched || ""} file{s(matched)} to folders</button>
        <button type="button" disabled={!matched} onClick={clearAssigned}>Clear matched</button>
      </div>

      <div className="sub-box">
        <div className="lbl">Name folders from file names</div>
        <small>For files the tree didn't match (forced files are skipped).</small>
        {RULES.map(([k, label]) => (
          <label key={k} className="chkrow"><input type="checkbox" checked={!!rules[k]} onChange={(e) => setRules((r) => ({ ...r, [k]: e.target.checked }))} /><span>{label}</span></label>
        ))}
        {suggestedFolders.length > 0 && (
          <>
            <div className="row">
              <button type="button" onClick={() => setEdits({ sig: suggestedSig, skipped: new Set(), renames })}>All</button>
              <button type="button" onClick={() => setEdits({ sig: suggestedSig, skipped: new Set(suggestedFolders.map(([f]) => f)), renames })}>None</button>
            </div>
            <ul className="pv" style={{ maxHeight: 240 }}>
              {suggestedFolders.map(([f, n]) => {
                const on = !skipped.has(f);
                return (
                  <li key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" style={{ flex: "0 0 20px", width: 20, height: 20, marginTop: 10 }} checked={on} aria-label={`Accept suggested folder ${f}`} onChange={(e) => setSkippedFor(f, !e.target.checked)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <WrapInput value={renames[f] ?? f} onChange={(v) => setRenameFor(f, v)} ariaLabel={`Folder name for ${f}`} dim={!on} />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <small><b>{n}</b> file{s(n)}</small>
                        <button type="button" style={{ flex: "0 0 auto", padding: "2px 8px", fontSize: 12 }} title="Put ALL files into this folder" onClick={() => applyAllTo(f)}>All files</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <button type="button" className="go" disabled={!chosenCount} onClick={applySuggested}>Name {chosenCount || ""} folder{s(chosenCount)} from file names</button>
      </div>

      <div className="lbl">Force folder for selected files</div>
      <input value={manual} onChange={(e) => setManual(e.target.value)} spellCheck={false} placeholder="Type or pick a folder…" />
      {folderSelect("Pick a folder to force", setManual)}
      <div className="row">
        <button type="button" className="go" disabled={!manual.trim() || !links.length} onClick={() => forceAssign()}>Force {links.length} selected here</button>
        <button type="button" disabled={!links.length} onClick={() => forceAssign(true)}>Unforce selected</button>
      </div>

      <div className="lbl">Add parent folder around selected files' folders</div>
      <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} placeholder="Type or pick a folder… e.g. Goosebumps (1995)" />
      {folderSelect("Pick a parent folder", setParent)}
      <button type="button" className="go" disabled={!parent.trim() || !links.length} onClick={addParent}>Wrap {links.length} selected in parent</button>
      <small>Folders that don't exist yet are created by the generated script.</small>
    </details>
  );
}
