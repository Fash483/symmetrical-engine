import React from "react";

/** Link Nest-style post-download media controls. */
export default function MediaTools({ value, onChange }) {
  const v = value || { setDate: false, datetime: "", ffmpeg: false, boostDb: 0, muxSubtitles: true };
  const patch = (p) => onChange({ ...v, ...p });
  return (
    <details className="box">
      <summary>🎞️ FFmpeg &amp; modified date/time</summary>
      <label className="chkrow"><input type="checkbox" checked={!!v.ffmpeg} onChange={e => patch({ ffmpeg: e.target.checked })}/><span>Enable FFmpeg processing (video + matching subtitles → MKV)</span></label>
      <label className="chkrow"><input type="checkbox" checked={!!v.muxSubtitles} onChange={e => patch({ muxSubtitles: e.target.checked })}/><span>Pair matching subtitle files</span></label>
      <label className="chkrow"><input type="checkbox" checked={!!v.setDate} onChange={e => patch({ setDate: e.target.checked })}/><span>Set modified date/time after download</span></label>
      <label><small>Modified date &amp; time (notebook timezone)</small><input type="datetime-local" value={v.datetime || ""} onChange={e => patch({ datetime: e.target.value })}/></label>
      <label><small>Audio boost (dB; 0 = unchanged)</small><input type="number" min="-60" max="60" step="0.5" value={v.boostDb ?? 0} onChange={e => patch({ boostDb: Math.max(-60, Math.min(60, Number(e.target.value) || 0)) })}/></label>
      <small>FFmpeg runs in the notebook after download. Original files are retained.</small>
    </details>
  );
}
