// =============================================================================
//  rejects/admin.js — סיכומי פגישה / ריג'קטים (punch lists, floor hand-overs, meeting notes)
//  A. Weiss dashboard · rejects build 1 · 03.11.2026 (site: build 233)
//
//  The dashboard loads this file when the cube is opened. Lists live in
//  public.rejects_lists (one row per list); photos in the "submittals" bucket
//  under <projectId>/rejects/<listId>/, with a small thumbnail kept on the row
//  for the screen and the printout.
//
//  Her layout (03.11.26):
//    main screen   "+ רשימה חדשה"; every list is a closed line showing its
//                  name, a click opens it; tick lists to print / export together
//    inside        name, date, attendees (blank = not printed); rows:
//                  מס"ד · קומה · תיאור · אחריות · מועד לביצוע · תמונות · תוכנית
//                  · הערות (dated, one under another); "טופל" V turns the row
//                  green; tick rows to print only those; a V in a column title
//                  decides whether that column prints. Landscape, house paper.
//  Saving follows the rule learned 14.10.26: only what was edited, only for the
//  list that was loaded, and an overtaken save stops.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";
import {
  Plus, Printer, FileDown, FileSpreadsheet, Trash2, Camera, Upload, ClipboardPaste, X, ChevronDown, ChevronLeft, Save, SlidersHorizontal, RotateCcw, Eye,
} from "lucide-react";
import { supabase, printSheetCss, printedStampText, imgPickProps, imgAsk } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;
export const REJECTS_BUILD = "rejects build 18 · 12.11.2026";
if (typeof console !== "undefined") console.info(REJECTS_BUILD);

const BUCKET = "submittals";
// The columns that can be left off the printout by the V in their title.
const COLS = [
  ["n", "מס\"ד"], ["floor", "קומה"], ["desc", "תיאור"], ["owner", "אחריות"], ["due", "מועד לביצוע"],
  ["photos", "תמונות"], ["plans", "תוכנית"], ["notes", "הערות"], ["done", "טופל"],
];
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// The local date, not UTC: at half past midnight in Israel UTC is still yesterday.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = (d) => { const s = String(d || "").slice(0, 10).split("-"); return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : ""; };
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const blankRow = () => ({ id: uid("r"), floor: "", desc: "", owner: "", due: "", photos: [], plans: [], notes: [], done: false });
// 11.11.26 (build 14) — the minutes of a meeting: who was there, a line per
// party ("א. וייס" — "מאור אליהו, מרסלה קרביץ"), and a general summary. They
// live in rejects_lists.minutes ({ people: [{ g, n }], summary }). A list from
// before keeps its one line of attendees, shown as one line with no party.
const peopleOf = (l) => {
  const m = (l && l.minutes) || {};
  const ppl = (Array.isArray(m.people) ? m.people : []).map((p) => ({ g: String((p && p.g) || ""), n: String((p && p.n) || "") }));
  if (ppl.length || m.people) return ppl;
  const old = String((l && l.attendees) || "").trim();
  return old ? [{ g: "", n: old }] : [];
};
const filledPeople = (l) => peopleOf(l).filter((p) => p.g.trim() || p.n.trim());
const personLine = (p) => (p.g.trim() && p.n.trim() ? `${p.g.trim()} - ${p.n.trim()}` : (p.g.trim() || p.n.trim()));
// the one-line form, for the subcontractor app and the band of a list printed with others
const attText = (l) => filledPeople(l).map(personLine).join(" · ");
const summaryOf = (l) => String(((l && l.minutes) || {}).summary || "").trim();
const colsOf = (l) => ({ n: true, desc: true, floor: true, owner: true, due: true, photos: true, plans: true, notes: true, done: true, ...((l && l.cols) || {}) });

// ----------------------------------------------------------------------------- pictures
function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    im.onerror = rej;
    im.src = url;
  });
}
function shrink(im, max, q) {
  const k = Math.min(1, max / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.naturalWidth * k));
  c.height = Math.max(1, Math.round(im.naturalHeight * k));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return c;
}
// One photo: a copy to storage, a 480px thumbnail kept on the row.
// 12.11.26 (build 17) — her rule: an uploaded file or a camera shot is
// compressed as before (1600px, JPEG 0.82); a pasted screenshot (Ctrl+V, or
// "paste" on the right-click) goes up exactly as it is — no resizing, no
// recompression — so a plan or an e-mail stays sharp in the PDF and when it is
// opened. A paste over 15 MB, which no screenshot is, is compressed after all.
async function storePhoto(projectId, listId, file, asIs) {
  const im = await loadImg(file);
  const thumb = shrink(im, 480, 0.72).toDataURL("image/jpeg", 0.72);
  let big, type = "image/jpeg", ext = "jpg";
  if (asIs && file.size <= 15 * 1024 * 1024) {
    big = file; type = file.type || "image/png";
    ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  } else {
    big = await new Promise((r) => shrink(im, 1600, 0.82).toBlob(r, "image/jpeg", 0.82));
  }
  const path = `${projectId}/rejects/${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, big, { contentType: type, upsert: false });
  return { id: uid("p"), path: error ? null : path, thumb, name: file.name || "photo.jpg" };
}
async function openPhoto(p) {
  if (p && p.path) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(p.path, 3600);
    if (data && data.signedUrl) { window.open(data.signedUrl, "_blank"); return; }
  }
  if (p && p.thumb) { const w = window.open(""); if (w) w.document.write(`<img src="${p.thumb}" style="max-width:100%">`); }
}

// ----------------------------------------------------------------------------- styles
const css = `
.rj{font-family:'Assistant','Inter',sans-serif;color:var(--ink,#17181c);font-size:14px;max-width:1400px;margin:0 auto;padding:0 12px 28px}
.rj .rjBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:8px 12px;margin-bottom:10px}
.rj .rjTop{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 12px}
.rj .rjOrient{display:inline-flex;border:1px solid #d5d9df;border-radius:8px;overflow:hidden;background:#fff}
.rj .rjOrient button{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;padding:6px 10px;font:inherit;font-size:12.5px;font-weight:600;color:#4b5160;cursor:pointer}
.rj .rjOrient button+button{border-inline-start:1px solid #d5d9df}
.rj .rjOrient button.on{background:#1A559E;color:#fff}
.rj .rjOrient .pgIco{display:inline-block;border:1.6px solid currentColor;border-radius:2px}
.rj .rjBtn.on{background:#eef3fa;border-color:#1A559E;color:#1A559E}
.rj .rjLayout{max-width:820px;margin:0 auto 14px;border:1px solid #d5d9df;border-radius:12px;background:#fff;padding:12px 14px;box-shadow:0 2px 10px rgba(16,52,96,.06)}
.rj .rjLayHead{text-align:center;margin-bottom:10px}.rj .rjLayHead b{display:block;color:#103460;font-size:14px}
.rj .rjLayHint{font-size:12px;color:#6b7280}
.rj .rjLayBar{position:relative;display:flex;margin:0 auto;border:1.5px solid #1A559E;border-radius:6px;overflow:visible;height:64px;user-select:none;touch-action:none}
.rj .rjLayBar.wide{width:100%}.rj .rjLayBar.tall{width:72%}
.rj .rjLaySeg{display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;background:#f4f6f9;border-inline-start:1px solid #d5d9df;font-size:11px;min-width:0}
.rj .rjLaySeg:first-child{border-inline-start:0}.rj .rjLaySeg.ph{background:#e6eef8}
.rj .rjLaySeg .t{font-weight:700;color:#103460;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;padding:0 2px}
.rj .rjLaySeg .p{color:#6b7280;font-size:10px}
.rj .rjLayDiv{position:absolute;top:-4px;bottom:-4px;width:10px;cursor:col-resize;z-index:2}
.rj .rjLayDiv::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:2px;background:#1A559E;border-radius:2px}
.rj .rjLayDiv:hover::after{left:3px;width:4px}
.rj .rjLayRow{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:12.5px}
.rj .rjLayLbl{font-weight:700;color:#3d4350}.rj .rjLaySize{color:#6b7280}
.rj .rjMin{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 8px}
.rj .rjMinBox{background:#f4f6f9;border:1px solid #dfe3ea;border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.rj .rjMinTtl{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:#17181c}
.rj .rjMinAdd{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:1px solid #1A559E;background:#fff;color:#1A559E;cursor:pointer}
.rj .rjMinRow{display:grid;grid-template-columns:1fr 2fr 28px;gap:6px;align-items:center}
.rj .rjMinRow .lliIn,.rj .rjMinSum{font-size:13px;text-align:start;width:100%;box-sizing:border-box}
.rj .rjMinSum{flex:1;min-height:70px;resize:vertical;font:inherit;font-size:13px}
.rj .rjMinDel{border:0;background:transparent;color:#9aa0aa;cursor:pointer;padding:2px}.rj .rjMinDel:hover{color:#c0392b}
@media (max-width:760px){.rj .rjMin{grid-template-columns:1fr}}
.rjPrev{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:18px}
.rjPrevBox{background:#fff;border-radius:14px;width:min(1180px,100%);height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.rjPrevHead{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #e6e8ec}
.rjPrevHead b{font-size:15px;color:#103460;margin-inline-end:8px}
.rjPrevNote{text-align:center;font-size:12px;color:#6b7280;padding:4px 0 6px}
.rjPrevFrame{flex:1;width:100%;border:0;background:#8a8f98}
.rjPrevWait{flex:1;display:flex;align-items:center;justify-content:center;color:#6b7280;margin:0}
.rj .rjOrient .pgIco.tall{width:9px;height:12px}.rj .rjOrient .pgIco.wide{width:12px;height:9px}
.rj input.rjPick{accent-color:var(--accent,#0F3460)}
.rj .rjTitle{font-weight:800;font-size:16px;margin-inline-end:auto}
.rj .rjBtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;padding:6px 12px;border-radius:9px;border:1px solid var(--line,#e6e6e9);background:#fff;color:var(--ink,#17181c);cursor:pointer;white-space:nowrap}
.rj .rjBtn:hover{border-color:var(--accent,#17181c)}
.rj .rjBtn.primary{background:var(--accent,#17181c);border-color:var(--accent,#17181c);color:#fff}
.rj .rjBtn.icon{padding:5px 7px}
.rj .rjBtn:disabled{opacity:.45;cursor:default}
.rj .rjWin{background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;overflow:auto}
.rj table{border-collapse:collapse;width:100%}
.rj th{background:#f4f6f9;font-weight:800;font-size:12.5px;padding:7px 8px;border-bottom:1px solid var(--line,#e6e6e9);text-align:center;white-space:nowrap}
.rj td{padding:6px 8px;border-bottom:1px solid var(--line,#e6e6e9);text-align:center;vertical-align:top;font-size:13.5px}
.rj tr.rjList td{vertical-align:middle;cursor:pointer}
.rj tr.rjList:hover td{background:#f7f8fa}
.rj tr.rjList.open td{background:#eef1f5;font-weight:700}
.rj tr.ok td{background:#e3f3e6}
.rj td.lbl{text-align:start}
.rj .rjIn{width:100%;min-width:70px;border:1px solid var(--line,#e6e6e9);border-radius:7px;padding:5px 7px;font:inherit;font-size:13px;background:#fff;box-sizing:border-box}
.rj textarea.rjIn{min-height:54px;resize:vertical}
.rj tr.ok .rjIn{background:#f4fbf5}
.rj input[type=checkbox]{width:17px;height:17px;cursor:pointer;accent-color:#1f7a3e}
.rj .rjHead{display:grid;grid-template-columns:3fr 1fr;gap:10px;background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:10px 12px;margin:8px 0}
.rj .rjHead label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;font-weight:700;color:var(--steel,#5b5e66);text-align:start}
.rj .rjOpen{padding:10px 10px 16px;background:#fafbfc}
.rj .shots{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-items:center;min-height:40px;outline:none;border-radius:8px;padding:3px}
.rj .shots:focus{box-shadow:0 0 0 2px #9fd3ae}
.rj .shot{position:relative;width:62px;height:62px;border-radius:7px;overflow:hidden;border:1px solid var(--line,#e6e6e9);cursor:zoom-in;background:#fff}
.rj .shot img{width:100%;height:100%;object-fit:cover;display:block}
.rj .shot button{position:absolute;top:1px;inset-inline-end:1px;border:0;border-radius:99px;background:rgba(0,0,0,.55);color:#fff;width:18px;height:18px;line-height:16px;font-size:12px;cursor:pointer;padding:0}
.rj .shotAdd{display:flex;gap:3px}
.rj .note{text-align:start;font-size:12.5px;line-height:1.4;padding:3px 0;border-bottom:1px dashed #e3e5ea;display:flex;gap:6px;align-items:flex-start}
.rj .note b{color:var(--steel,#5b5e66);font-weight:800;white-space:nowrap;direction:ltr}
.rj .note span{flex:1;white-space:pre-wrap}
.rj .note button{border:0;background:none;color:#b02a37;cursor:pointer;padding:0 2px}
.rj .noteAdd{display:flex;gap:4px;margin-top:4px}
.rj .thV{display:flex;flex-direction:column;align-items:center;gap:2px}
.rj .thV input{width:14px;height:14px}
.rj .rjErr{color:#b02a37;font-weight:600;text-align:center;margin:8px 0}
.rj .rjSaved{font-size:12.5px;color:#1f7a3e;font-weight:700}
.rj .rjEmpty{padding:20px;text-align:center;color:var(--mist,#9a9da5)}
.rj .rjToast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#101114;color:#fff;padding:9px 16px;border-radius:10px;font-weight:600;font-size:13px;z-index:900}
/* 03.11.26 — the boards' own look: the LLI table (lliTable / lliIn / sbColTick,
   defined by the dashboard), every box on one middle line. */
.rj .lliTable td{vertical-align:middle}
.rj .lliTable tbody tr.ok td{background:#e3f3e6}
.rj .lliTable tbody tr.rjList td{cursor:pointer}
.rj .lliTable tbody tr.rjList:hover td{background:#f7f8fa}
.rj .lliTable tbody tr.rjList.open td{background:#eef1f5;font-weight:800}
.rj .lliTable .lliIn{box-sizing:border-box}
.rj .lliTable input[type=date].lliIn{text-align:center}
.rj .rjTableWrap{max-height:none}
/* an open list never widens the list of lists: it scrolls inside itself */
.rj .rjOpenIn{width:0;min-width:100%}
.rj .rjOpenIn .lliTableWrap{max-width:100%}
.rj .rjRows th.prColTh{white-space:nowrap}
/* the LLI board is 1520px wide by its own rule; these tables are not */
.rj .lliTable{min-width:0}
.rj .rjRows{min-width:1290px}
.rj input.sbColTick{width:13px;height:13px;accent-color:var(--accent,#0F3460)}
/* photo boxes: half the LLI picture box; one empty box is always the next one */
.rj .rjBoxes{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center}
.rj .rjBox{position:relative;width:92px;height:80px;border:1px dashed var(--line,#e6e6e9);border-radius:8px;background:#fff;
  display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;color:var(--mist,#9a9da5);outline:none}
.rj .rjBox img{width:100%;height:100%;object-fit:contain}
.rj .rjBox:hover{border-color:var(--accent,#17181c)}
.rj .rjBox.sel,.rj .rjBox:focus{border-style:solid;border-color:var(--accent,#0F3460);box-shadow:0 0 0 2px var(--accent-soft,#e6ecf5)}
.rj .rjBox .x{position:absolute;top:2px;inset-inline-end:2px;border:0;border-radius:99px;background:rgba(0,0,0,.55);color:#fff;
  width:17px;height:17px;line-height:15px;font-size:12px;cursor:pointer;padding:0}
.rj .rjBox .acts{position:absolute;bottom:2px;inset-inline:2px;display:flex;justify-content:center;gap:3px}
.rj .rjBox .acts button{width:22px;height:20px;border:1px solid var(--line,#e6e6e9);border-radius:4px;background:#fff;color:var(--steel,#5b5e66);
  padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer}
.rj .rjBox .hint{font-size:10px;line-height:1.2;text-align:center;padding:0 4px 18px}
.rj .rjView{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:8px 12px;margin-bottom:10px}
.rj .rjView .who{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid var(--line,#e6e6e9);border-radius:99px;padding:3px 10px;background:#fff;cursor:pointer}
.rj .rjView .who.on{background:#e3f3e6;border-color:#9fd3ae}
.rj .rjView .who.pm{background:#f4f6f9;color:var(--steel,#5b5e66);cursor:default}
@media (max-width:760px){.rj .rjHead{grid-template-columns:1fr}.rj .rjBtn .lbl{display:none}}
`;

// ----------------------------------------------------------------------------- the module
// The print-layout panel: a strip shaped like the page, one block per printed
// column; drag a border between two blocks to give one more of the width and
// the other less. Under it: photos to a line, and the size that gives them.
export function LayoutPanel({ wide, cols, layout, onChange, onClose }) {
  const bar = useRef(null);
  const [live, setLive] = useState(null);                // the shares while dragging
  const shares = live || cols.map((c) => c[2]);
  const per = Math.max(1, Math.min(6, +((layout && layout.per) || PER_LINE_DEFAULT)));
  const iPh = cols.findIndex((c) => c[0] === "photos");
  const box = iPh >= 0 ? photoBox(shares[iPh], wide, per) : null;
  const commit = (arr) => onChange({ ...(layout || {}), w: Object.fromEntries(cols.map((c, i) => [c[0], +arr[i].toFixed(2)])) });
  const startDrag = (i) => (e) => {
    e.preventDefault();
    const el = bar.current; if (!el) return;
    const width = el.getBoundingClientRect().width || 1;
    const x0 = e.clientX, base = shares.slice();
    let cur = base;
    const move = (ev) => {
      // right to left: block i sits to the right of the border, i+1 to its left;
      // moving the border left widens block i
      const d = ((x0 - ev.clientX) / width) * 100;
      const a = Math.max(2, Math.min(base[i] + base[i + 1] - 2, base[i] + d));
      cur = base.slice(); cur[i] = a; cur[i + 1] = base[i] + base[i + 1] - a;
      setLive(cur);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setLive(null); commit(cur); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  let acc = 0;
  return html`<div className="rjLayout" dir="rtl">
    <div className="rjLayHead"><b>פריסת ההדפסה — ${wide ? "לרוחב" : "לאורך"}</b>
      <span className="rjLayHint">גררי את הקו בין שתי עמודות כדי להרחיב אחת ולצמצם את השכנה. נשמר לכל כיוון דף בנפרד.</span></div>
    <div className=${"rjLayBar " + (wide ? "wide" : "tall")} ref=${bar}>
      ${cols.map((c, i) => html`<div key=${c[0]} className=${"rjLaySeg" + (c[0] === "photos" ? " ph" : "")} style=${{ width: shares[i] + "%" }}>
        <span className="t">${c[1]}</span><span className="p">${Math.round(shares[i])}%</span></div>`)}
      ${cols.slice(0, -1).map((c, i) => { acc += shares[i]; return html`<span key=${"d" + c[0]} className="rjLayDiv" style=${{ right: `calc(${acc}% - 5px)` }} onPointerDown=${startDrag(i)} title="גררי"></span>`; })}
    </div>
    <div className="rjLayRow">
      ${iPh >= 0 && html`<span className="rjLayLbl">תמונות בשורה:</span>
      <span className="rjOrient">${[2, 3, 4, 5].map((k) => html`<button type="button" key=${k} className=${per === k ? "on" : ""} onClick=${() => onChange({ ...(layout || {}), per: k })}>${k}</button>`)}</span>
      <span className="rjLaySize">גודל תמונה בהדפסה: כ-${Math.round(box.w * 25.4 / 96)}×${Math.round(box.h * 25.4 / 96)} מ״מ</span>`}
      <button type="button" className="rjBtn" onClick=${() => onChange({})} title="חזרה לפריסה הרגילה"><${RotateCcw} size=${14} /><span className="lbl">איפוס</span></button>
      <button type="button" className="rjBtn" onClick=${onClose}><${X} size=${14} /><span className="lbl">סגירה</span></button>
    </div>
  </div>`;
}

// 12.11.26 (build 16) — a preview of the printout before exporting it: the
// pages as they will be dealt, with the small thumbnails (only the shape of the
// form matters here; the PDF itself carries the full photos). The direction can
// be switched in it, and "ייצוא PDF" exports from it.
function PrintPreview({ build, wide, setOrient, onExport, onClose }) {
  const [doc, setDoc] = useState("");
  useEffect(() => {
    let off = false; setDoc("");
    build().then((d) => {
      if (off || !d) return;
      // grey desk, pages with a shadow, all of a page in view at the panel's width
      const extra = `<style>html,body{background:#8a8f98!important}#pages{padding:14px 0}#pages .page{margin:0 auto 14px;box-shadow:0 2px 12px rgba(0,0,0,.35)}</style>
<script>(function(){function fit(){var p=document.querySelector("#pages .page");var el=document.getElementById("pages");if(!p||!el)return;el.style.zoom="";var z=Math.min(1,(window.innerWidth-28)/p.offsetWidth);el.style.zoom=z;}window.addEventListener("resize",fit);var t=setInterval(function(){if(window.__awPaged){clearInterval(t);fit();}},120);})();<\/script>`;
      setDoc(d.replace("</head>", extra + "</head>"));
    }).catch((e) => console.warn("[rejects] preview", e));
    return () => { off = true; };
  }, [build]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return html`<div className="rjPrev" dir="rtl" onClick=${onClose}>
    <div className="rjPrevBox" onClick=${(e) => e.stopPropagation()}>
      <div className="rjPrevHead">
        <b>תצוגה מקדימה</b>
        <span className="rjOrient" role="group" aria-label="כיוון הדף">
          <button type="button" className=${!wide ? "on" : ""} onClick=${() => setOrient("portrait")}><span className="pgIco tall"></span>לאורך</button>
          <button type="button" className=${wide ? "on" : ""} onClick=${() => setOrient("landscape")}><span className="pgIco wide"></span>לרוחב</button>
        </span>
        <button type="button" className="rjBtn primary" onClick=${onExport}><${FileDown} size=${15} /><span>ייצוא PDF</span></button>
        <button type="button" className="rjBtn" onClick=${onClose} title="סגירה (Esc)"><${X} size=${15} /><span>סגירה</span></button>
      </div>
      <div className="rjPrevNote">התמונות כאן מוקטנות — רק לראות את מבנה הטופס. ב-PDF הן מלאות וחדות.</div>
      ${doc ? html`<iframe className="rjPrevFrame" title="תצוגה מקדימה" srcDoc=${doc}></iframe>` : html`<p className="rjPrevWait">מכין תצוגה…</p>`}
    </div>
  </div>`;
}

export function RejectsBoard({ projectId, projectName, projectEnd, printParts, currentEmail, subs }) {
  const [lists, setLists] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);
  const [picked, setPicked] = useState({});           // lists ticked for print / export
  // 05.11.26 — every row prints until its V is taken off; a row without its V
  // stays editable but is greyed.
  const [rowOff, setRowOff] = useState({});
  // 11.11.26 (build 12) — the PDF prints across (landscape) or upright (portrait),
  // her choice, remembered on this computer; the columns are laid out for the page.
  const [orient, setOrientRaw] = useState(() => { try { return localStorage.getItem("rj-print-orient") === "portrait" ? "portrait" : "landscape"; } catch (e) { return "landscape"; } });
  const setOrient = (v) => { setOrientRaw(v); try { localStorage.setItem("rj-print-orient", v); } catch (e) {} };
  // 11.11.26 (build 13) — her own layout per direction: column widths and photos to a line
  const [layouts, setLayouts] = useState(() => ({ landscape: layoutLoad("landscape"), portrait: layoutLoad("portrait") }));
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewBuild = useRef({ key: null, fn: null });
  const setLayout = (v) => { setLayouts((cur) => ({ ...cur, [orient]: v })); layoutSave(orient, v); };           // listId -> { rowId: true }: rows taken out of print
  const [saveState, setSaveState] = useState("");
  const [toast, setToast] = useState("");
  const dirty = useRef({});                           // listId -> true
  const runs = useRef({});                            // listId -> newest save number
  const timer = useRef(null);
  const listsRef = useRef(null);
  listsRef.current = lists;
  const flash = (t) => { setToast(t); setTimeout(() => setToast(""), 1900); };

  useEffect(() => {
    let off = false;
    setLists(null); setErr(""); dirty.current = {};
    (async () => {
      const { data, error } = await supabase.from("rejects_lists").select("*").eq("project_id", projectId).order("created_at");
      if (off) return;
      if (error) {
        console.warn("[rejects] load failed", error);
        setErr(/relation|does not exist|schema cache/i.test(error.message || "")
          ? "טבלת הריג'קטים עדיין לא קיימת ב-Supabase — יש להריץ את rejects/supabase/001_rejects.sql"
          : "טעינת הרשימות נכשלה: " + (error.message || ""));
        setLists([]);
        return;
      }
      console.info("[rejects] loaded", projectId, (data || []).length, "lists");
      setLists((data || []).map((l) => ({ ...l, rows: Array.isArray(l.rows) ? l.rows : [] })));
    })();
    return () => { off = true; };
  }, [projectId]);

  // ---------------------------------------------------------------- saving
  const saveOne = async (id) => {
    const l = (listsRef.current || []).find((x) => x.id === id);
    if (!l || l.project_id !== projectId) return;
    const run = (runs.current[id] = (runs.current[id] || 0) + 1);
    delete dirty.current[id];
    const { error } = await supabase.from("rejects_lists").upsert({
      id: l.id, project_id: projectId, name: l.name || "", list_date: l.list_date || null, attendees: attText(l),
      minutes: { people: peopleOf(l), summary: ((l.minutes || {}).summary) || "" }, rows: l.rows || [], cols: l.cols || {}, viewers: l.viewers || [], created_at: l.created_at, updated_at: new Date().toISOString(), updated_by: currentEmail || null,
    }, { onConflict: "id" });
    if (run !== runs.current[id]) return;
    if (error) {
      dirty.current[id] = true;
      setErr(/minutes/.test(error.message || "") ? "חסרה עמודת הנוכחים/סיכום ב-Supabase — יש להריץ את rejects/supabase/002_minutes.sql" : "השמירה נכשלה: " + (error.message || ""));
      setSaveState(""); return;
    }
    console.info("[rejects] saved", id);
    setErr("");
  };
  const saveAll = async () => {
    clearTimeout(timer.current);
    const ids = Object.keys(dirty.current);
    if (!ids.length) return;
    setSaveState("saving");
    await Promise.all(ids.map(saveOne));
    setSaveState("saved");
    setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 2000);
  };
  const saveRef = useRef(saveAll);
  saveRef.current = saveAll;
  useEffect(() => () => { if (Object.keys(dirty.current).length) saveRef.current(); }, []);

  const editList = (id, fn) => {
    setLists((cur) => {
      const next = (cur || []).map((l) => (l.id === id ? fn(structuredClone(l)) : l));
      listsRef.current = next;
      return next;
    });
    dirty.current[id] = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), 900);
  };

  // ---------------------------------------------------------------- Back button closes an open list
  const openRef = useRef(null);
  openRef.current = openId;
  useEffect(() => {
    const onPop = () => { if (openRef.current) setOpenId(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const toggleOpen = (id) => {
    if (openId === id) { try { window.history.back(); } catch (e) { setOpenId(null); } return; }
    if (!openId) { try { window.history.pushState({ awrj: Date.now() }, ""); } catch (e) {} }
    setOpenId(id);
  };

  const addList = () => {
    const l = { id: uid("rl"), project_id: projectId, name: "", list_date: today(), attendees: "", rows: [blankRow()], cols: {}, created_at: new Date().toISOString() };
    setLists((cur) => { const next = (cur || []).concat([l]); listsRef.current = next; return next; });
    dirty.current[l.id] = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), 900);
    toggleOpen(l.id);
  };
  const removeList = async (l) => {
    if (!confirm(`למחוק את הרשימה "${l.name || "ללא שם"}"?`)) return;
    const { error } = await supabase.from("rejects_lists").delete().eq("id", l.id);
    if (error) { setErr("המחיקה נכשלה: " + (error.message || "")); return; }
    const paths = (l.rows || []).flatMap((r) => (r.photos || []).concat(r.plans || [])).map((p) => p && p.path).filter(Boolean);
    if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    delete dirty.current[l.id];
    if (openId === l.id) setOpenId(null);
    setLists((cur) => (cur || []).filter((x) => x.id !== l.id));
  };

  if (!lists) return html`<div className="rj" dir="rtl"><style>${css}</style><p className="rjEmpty">טוען…</p></div>`;

  // 03.11.26 — one PDF and one Excel button, at the top. The lists ticked
  // print (nothing ticked: every list); inside a list, the rows that still
  // carry their print V (05.11.26). A list with every row taken out is left out.
  const offOf = (l) => rowOff[l.id] || {};
  const rowsOn = (l) => (l.rows || []).filter((r) => !offOf(l)[r.id]).map((r) => r.id);
  const someOff = (l) => (l.rows || []).some((r) => offOf(l)[r.id]);
  const targets = lists.filter((l) => picked[l.id]);
  const forOut = (targets.length ? targets : lists).filter((l) => !(l.rows || []).length || rowsOn(l).length);
  const pickMap = {};
  forOut.forEach((l) => { if (someOff(l)) pickMap[l.id] = rowsOn(l); });
  const nOut = targets.length;
  const doPrint = () => printLists({ lists: forOut, rowPick: pickMap, projectName, projectEnd, landscape: orient !== "portrait", layout: layouts[orient], ...(printParts || {}) });
  // the preview is rebuilt whenever what would print changes
  const previewKey = previewOpen ? JSON.stringify([orient, layouts[orient], forOut.map((l) => [l.id, l.updated_at, (l.rows || []).length]), pickMap]) : "";
  // (kept in a ref: this part of the board runs after the early return above,
  // where no hook may be called)
  if (previewBuild.current.key !== previewKey) {
    const args = { lists: forOut, rowPick: pickMap, projectName, projectEnd, landscape: orient !== "portrait", layout: layouts[orient], ...(printParts || {}), docOnly: true };
    previewBuild.current = { key: previewKey, fn: () => printLists(args) };
  }
  const buildPreview = previewBuild.current.fn;
  const doExcel = () => excelLists({ lists: forOut, rowPick: pickMap, projectName }).catch((e) => flash("הייצוא נכשל: " + (e.message || e)));
  const allPicked = lists.length > 0 && lists.every((l) => picked[l.id]);

  return html`<div className="rj" dir="rtl"><style>${css}</style>
    <div className="rjTop">
      <button type="button" className="rjBtn primary" onClick=${addList}><${Plus} size=${15} strokeWidth=${2.4} /><span className="lbl">רשימה חדשה</span></button>
      <span className="rjOrient" role="group" aria-label="כיוון הדף">
        <button type="button" className=${orient === "portrait" ? "on" : ""} onClick=${() => setOrient("portrait")} title="הדפסה לאורך">
          <span className="pgIco tall"></span>לאורך</button>
        <button type="button" className=${orient !== "portrait" ? "on" : ""} onClick=${() => setOrient("landscape")} title="הדפסה לרוחב">
          <span className="pgIco wide"></span>לרוחב</button>
      </span>
      <button type="button" className=${"rjBtn" + (layoutOpen ? " on" : "")} disabled=${!lists.length} onClick=${() => setLayoutOpen((v) => !v)}
        title="רוחב העמודות וגודל התמונות בהדפסה"><${SlidersHorizontal} size=${15} /><span className="lbl">פריסה</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${() => setPreviewOpen(true)}
        title="איך הטופס ייראה בהדפסה"><${Eye} size=${15} /><span className="lbl">תצוגה מקדימה</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${doPrint}
        title=${(orient === "portrait" ? "PDF לאורך" : "PDF לרוחב") + (nOut ? " — הרשימות והשורות המסומנות" : " — כל הרשימות")}>
        <${FileDown} size=${15} /><span className="lbl">PDF${nOut ? ` (${nOut})` : ""}</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${doExcel}
        title=${nOut ? "אקסל — הרשימות והשורות המסומנות" : "אקסל — כל הרשימות"}>
        <${FileSpreadsheet} size=${15} /><span className="lbl">אקסל${nOut ? ` (${nOut})` : ""}</span></button>
    </div>
    ${layoutOpen && lists.length > 0 && html`<${LayoutPanel} wide=${orient !== "portrait"} cols=${printColumns(forOut, orient !== "portrait", layouts[orient])}
      layout=${layouts[orient]} onChange=${setLayout} onClose=${() => setLayoutOpen(false)} />`}
    ${previewOpen && lists.length > 0 && html`<${PrintPreview} build=${buildPreview} wide=${orient !== "portrait"} setOrient=${setOrient}
      onExport=${() => { setPreviewOpen(false); doPrint(); }} onClose=${() => setPreviewOpen(false)} />`}
    ${err && html`<p className="rjErr">${err}</p>`}
    <div className="lliTableWrap rjTableWrap"><table className="lliTable">
      <colgroup><col style=${{ width: 56 }} /><col /><col style=${{ width: 130 }} /><col style=${{ width: 90 }} /><col style=${{ width: 90 }} /><col style=${{ width: 60 }} /></colgroup>
      <thead><tr>
        <th title="להדפסה"><span className="sbColThIn"><${Printer} size=${14} /><input type="checkbox" className="sbColTick" title="סימון הכול להדפסה" checked=${allPicked}
          onChange=${(e) => setPicked(e.target.checked ? Object.fromEntries(lists.map((l) => [l.id, true])) : {})} /></span></th>
        <th style=${{ textAlign: "start" }}>שם הרשימה</th><th>תאריך</th><th>שורות</th><th>טופלו</th><th style=${{ width: 70 }}></th>
      </tr></thead>
      <tbody>
        ${lists.length === 0 && html`<tr><td colSpan="6" className="rjEmpty">עדיין אין רשימות — "+ רשימה חדשה"</td></tr>`}
        ${lists.map((l) => {
          const open = openId === l.id;
          const n = (l.rows || []).length, d = (l.rows || []).filter((r) => r.done).length;
          return html`<${F} key=${l.id}>
            <tr className=${`rjList${open ? " open" : ""}`} onClick=${() => toggleOpen(l.id)}>
              <td onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${!!picked[l.id]}
                onChange=${(e) => setPicked({ ...picked, [l.id]: e.target.checked })} /></td>
              <td className="lbl"><span style=${{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                ${open ? html`<${ChevronDown} size=${15} />` : html`<${ChevronLeft} size=${15} />`} ${l.name || html`<i style=${{ color: "#9a9da5" }}>ללא שם</i>`}</span></td>
              <td style=${{ direction: "ltr" }}>${fmt(l.list_date) || "—"}</td>
              <td>${n}</td>
              <td style=${{ color: n && d === n ? "#1f7a3e" : undefined, fontWeight: n && d === n ? 800 : undefined }}>${d}/${n}</td>
              <td onClick=${(e) => e.stopPropagation()}><button type="button" className="rjBtn icon" title="מחיקת הרשימה" onClick=${() => removeList(l)}><${Trash2} size=${14} color="#b02a37" /></button></td>
            </tr>
            ${open && html`<tr><td colSpan="6" className="rjOpen">
              <div className="rjOpenIn"><${ListEditor} list=${l} projectId=${projectId} projectName=${projectName} subs=${subs || []} edit=${(fn) => editList(l.id, fn)} flash=${flash}
                off=${rowOff[l.id] || {}} setOff=${(m) => setRowOff({ ...rowOff, [l.id]: m })}
                onSave=${saveAll} saveState=${saveState} /></div>
            </td></tr>`}
          <//>`;
        })}
      </tbody>
    </table></div>
    ${toast && html`<div className="rjToast">${toast}</div>`}
    <p style=${{ textAlign: "center", fontSize: 10.5, color: "#9a9da5", margin: "14px 0 0", direction: "ltr" }}>${REJECTS_BUILD}</p>
  </div>`;
}

// ----------------------------------------------------------------------------- one list
// Who was there (a line per party, + adds a line) beside the general summary.
// Both are left out of the printout while empty.
function Minutes({ list, edit }) {
  const ppl = peopleOf(list);
  const setPeople = (fn) => edit((l) => ({ ...l, minutes: { ...(l.minutes || {}), people: fn(peopleOf(l)) } }));
  const shown = ppl.length ? ppl : [{ g: "", n: "" }];
  return html`<div className="rjMin">
    <div className="rjMinBox">
      <div className="rjMinTtl"><b>נוכחים</b>
        <button type="button" className="rjMinAdd" title="הוספת שורה" onClick=${() => setPeople((p) => (p.length ? p : [{ g: "", n: "" }]).concat([{ g: "", n: "" }]))}><${Plus} size=${14} strokeWidth=${2.6} /></button></div>
      ${shown.map((p, i) => html`<div className="rjMinRow" key=${i}>
        <input className="lliIn" placeholder="קבוצה — למשל א. וייס / פיקוח / יועץ חשמל" value=${p.g}
          onChange=${(e) => setPeople((cur) => { const c = cur.length ? cur.slice() : [{ g: "", n: "" }]; c[i] = { ...c[i], g: e.target.value }; return c; })} />
        <input className="lliIn" placeholder="שמות — למשל מאור אליהו, מרסלה קרביץ" value=${p.n}
          onChange=${(e) => setPeople((cur) => { const c = cur.length ? cur.slice() : [{ g: "", n: "" }]; c[i] = { ...c[i], n: e.target.value }; return c; })} />
        <button type="button" className="rjMinDel" title="מחיקת השורה" onClick=${() => setPeople((cur) => cur.filter((_, j) => j !== i))}><${Trash2} size=${14} /></button>
      </div>`)}
    </div>
    <div className="rjMinBox">
      <div className="rjMinTtl"><b>סיכום כללי</b></div>
      <textarea className="lliIn rjMinSum" rows="4" placeholder="סיכום כללי של הפגישה / הסיור" value=${((list.minutes || {}).summary) || ""}
        onChange=${(e) => edit((l) => ({ ...l, minutes: { ...(l.minutes || {}), people: peopleOf(l), summary: e.target.value } }))}></textarea>
    </div>
  </div>`;
}

function ListEditor({ list, projectId, projectName, subs, edit, flash, off, setOff, onSave, saveState }) {
  const cols = colsOf(list);
  const rows = list.rows || [];
  const setRow = (id, patch) => edit((l) => { l.rows = (l.rows || []).map((r) => (r.id === id ? { ...r, ...patch } : r)); return l; });
  const addRow = () => edit((l) => { l.rows = (l.rows || []).concat([blankRow()]); return l; });
  const delRow = (r) => {
    if (!confirm(`למחוק את שורה ${rows.indexOf(r) + 1}?`)) return;
    const paths = (r.photos || []).concat(r.plans || []).map((p) => p && p.path).filter(Boolean);
    if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    edit((l) => { l.rows = (l.rows || []).filter((x) => x.id !== r.id); return l; });
  };
  const setCol = (k, v) => edit((l) => { l.cols = { ...(l.cols || {}), [k]: v }; return l; });
  // 05.11.26 — the column title is the switch, as on the other boards: dark
  // prints; a click greys it and strikes it through, and it is left out.
  const thV = (k, label) => html`<th key=${k} className=${`prColTh ${cols[k] === false ? "off" : ""}`}
    title=${cols[k] === false ? "לא מודפסת — לחיצה תחזיר את העמודה להדפסה" : "מודפסת — לחיצה תוציא את העמודה מה-PDF ומהאקסל"}
    onClick=${() => setCol(k, cols[k] === false)}>${label}</th>`;

  return html`<${F}>
    <div className="rjHead">
      <label>שם הרשימה<input className="lliIn" style=${{ textAlign: "start", fontSize: 13 }} value=${list.name || ""} placeholder="למשל: ריג'קטים חשמל קומה 7"
        autoFocus=${!list.name} onChange=${(e) => edit((l) => ({ ...l, name: e.target.value }))} /></label>
      <label>תאריך<input className="lliIn" style=${{ fontSize: 13 }} type="date" value=${list.list_date || ""} onChange=${(e) => edit((l) => ({ ...l, list_date: e.target.value }))} /></label>
    </div>
    <${Minutes} list=${list} edit=${edit} />
    <${Viewers} value=${list.viewers || []} onChange=${(v) => edit((l) => ({ ...l, viewers: v }))} />
    <div className="lliTableWrap rjTableWrap"><table className="lliTable rjRows">
      <colgroup><col style=${{ width: 44 }} /><col style=${{ width: 62 }} /><col style=${{ width: 70 }} /><col style=${{ width: 230 }} />
        <col style=${{ width: 130 }} /><col style=${{ width: 140 }} /><col style=${{ width: 210 }} /><col style=${{ width: 120 }} />
        <col style=${{ width: 220 }} /><col style=${{ width: 44 }} /><col style=${{ width: 62 }} /></colgroup>
      <thead><tr>
        <th className=${`prAllTh prPrintTh ${rows.every((r) => !off[r.id]) ? "on" : ""}`}
          title=${rows.every((r) => !off[r.id]) ? "כל השורות מסומנות להדפסה — לחיצה מבטלת את כל הסימונים" : "לחיצה מסמנת את כל השורות להדפסה"}
          onClick=${() => setOff(rows.every((r) => !off[r.id]) ? Object.fromEntries(rows.map((r) => [r.id, true])) : {})}><${Printer} size=${16} /></th>
        ${thV("n", "מס\"ד")}
        ${thV("floor", "קומה")}
        ${thV("desc", "תיאור")}
        ${thV("owner", "אחריות")}
        ${thV("due", "מועד לביצוע")}
        ${thV("photos", "תמונות")}
        ${thV("plans", "תוכנית")}
        ${thV("notes", "הערות")}
        <th></th>
        ${thV("done", "טופל")}
      </tr></thead>
      <tbody>
        ${rows.length === 0 && html`<tr><td colSpan="11" className="rjEmpty">אין שורות — "+ שורה"</td></tr>`}
        ${rows.map((r, i) => html`<tr key=${r.id} className=${`${r.done ? "ok" : ""} ${off[r.id] ? "prOff" : ""}`.trim()}>
          <td className="prKeep"><input type="checkbox" className="rjPick" title="להדפסה ולאקסל" checked=${!off[r.id]} onChange=${() => setOff({ ...off, [r.id]: !off[r.id] })} /></td>
          <td style=${{ fontWeight: 800, color: "#5b5e66" }}>${i + 1}</td>
          <td><input className="lliIn" value=${r.floor || ""} onChange=${(e) => setRow(r.id, { floor: e.target.value })} /></td>
          <td><textarea className="lliIn lliDesc" rows="2" dir="auto" value=${r.desc || ""} onChange=${(e) => setRow(r.id, { desc: e.target.value })} /></td>
          <td><input className="lliIn" value=${r.owner || ""} onChange=${(e) => setRow(r.id, { owner: e.target.value })} /></td>
          <td><input className="lliIn" type="date" value=${r.due || ""} onChange=${(e) => setRow(r.id, { due: e.target.value })} /></td>
          <td><${Shots} items=${r.photos || []} projectId=${projectId} projectName=${projectName} libLabel=${[list.name, r.floor, String(r.desc || "").split("\n")[0]].filter(Boolean).join(" · ")} listId=${list.id} flash=${flash}
            onChange=${(next) => setRow(r.id, { photos: typeof next === "function" ? next(r.photos || []) : next })} rowEdit=${(fn) => edit((l) => { l.rows = (l.rows || []).map((x) => (x.id === r.id ? { ...x, photos: fn(x.photos || []) } : x)); return l; })} /></td>
          <td><${Shots} items=${r.plans || []} projectId=${projectId} projectName=${projectName} libLabel=${[list.name, r.floor, String(r.desc || "").split("\n")[0]].filter(Boolean).join(" · ")} listId=${list.id} flash=${flash} noCamera=${true}
            rowEdit=${(fn) => edit((l) => { l.rows = (l.rows || []).map((x) => (x.id === r.id ? { ...x, plans: fn(x.plans || []) } : x)); return l; })} /></td>
          <td><${Notes} notes=${r.notes || []}
            onChange=${(fn) => edit((l) => { l.rows = (l.rows || []).map((x) => (x.id === r.id ? { ...x, notes: fn(x.notes || []) } : x)); return l; })} /></td>
          <td><button type="button" className="rjBtn icon" title="מחיקת השורה" onClick=${() => delRow(r)}><${Trash2} size=${14} color="#b02a37" /></button></td>
          <td><input type="checkbox" title="טופל" checked=${!!r.done} onChange=${(e) => setRow(r.id, { done: e.target.checked })} /></td>
        </tr>`)}
      </tbody>
    </table></div>
    <div style=${{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 10 }}>
      <button type="button" className="rjBtn" onClick=${addRow}><${Plus} size=${15} strokeWidth=${2.4} /> שורה</button>
      <button type="button" className="rjBtn primary" onClick=${onSave}><${Save} size=${15} /> שמירה</button>
      ${saveState === "saving" && html`<span className="rjSaved" style=${{ color: "#5b5e66" }}>שומר…</span>`}
      ${saveState === "saved" && html`<span className="rjSaved">נשמר ✓</span>`}
    </div>
  <//>`;
}

// ----------------------------------------------------------------------------- who may view this list in the app
// 06.11.26 — a list is made for a kind of subcontractor (the electrician, the
// HVAC contractor…), or for nobody: an internal list of ours. Every
// subcontractor of a ticked trade sees it in the app, view only. Project
// managers see every list anyway. The choice is kept in "viewers" as
// "trade:<key>", beside any person ticked by name in the past.
export const REJECT_TRADES = [
  ["hvac", "מיזוג אוויר"], ["electric", "חשמל"], ["plumbing", "אינסטלציה"],
  ["drywall", "גבס"], ["security", "ביטחון, מולטימדיה ותקשורת"], ["paint", "צבע"],
];
function Viewers({ value, onChange }) {
  const v = Array.isArray(value) ? value : [];
  const on = (k) => v.indexOf("trade:" + k) >= 0;
  const anyTrade = REJECT_TRADES.some(([k]) => on(k));
  const people = v.filter((x) => String(x).indexOf("trade:") !== 0);
  const toggle = (k) => onChange(on(k) ? v.filter((x) => x !== "trade:" + k) : v.concat(["trade:" + k]));
  return html`<div className="rjView">
    <span style=${{ fontSize: 12.5, fontWeight: 800, color: "#14181f", alignSelf: "center" }}>סוג קבלן:</span>
    <label className=${`who ${!anyTrade ? "on" : ""}`}>
      <input type="checkbox" checked=${!anyTrade} onChange=${() => onChange(people)} />ללא קבלן — רשימה פנימית</label>
    ${REJECT_TRADES.map(([k, he]) => html`<label key=${k} className=${`who ${on(k) ? "on" : ""}`}>
      <input type="checkbox" checked=${on(k)} onChange=${() => toggle(k)} />${he}</label>`)}
  </div>`;
}

// ----------------------------------------------------------------------------- photos: paste, upload, camera
function Shots({ items, projectId, projectName, libLabel, listId, flash, rowEdit, noCamera }) {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [busy, setBusy] = useState(0);
  // pasted: Ctrl+V (asIs), or the right-click "paste", whose file is named pasted.*
  const add = async (files, pasted) => {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type || "image/"));
    if (!list.length) return;
    setBusy((b) => b + list.length);
    for (const f of list) {
      try {
        const p = await storePhoto(projectId, listId, f, !!pasted || /^pasted\./.test(f.name || ""));
        if (!p.path) flash("התמונה נשמרה בתצוגה מוקטנת בלבד — העלאה לאחסון נכשלה");
        rowEdit((cur) => cur.concat([p]));
      } catch (e) { flash("הוספת התמונה נכשלה"); }
      setBusy((b) => b - 1);
    }
  };
  const onPaste = (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) { e.preventDefault(); add(files, true); }
  };
  const remove = (p) => {
    if (!confirm("להסיר את התמונה?")) return;
    if (p.path) supabase.storage.from(BUCKET).remove([p.path]).catch(() => {});
    rowEdit((cur) => cur.filter((x) => x.id !== p.id));
  };
  // A box per picture, and always one empty box after them: click it, then
  // Ctrl+V — or the two small buttons inside it. A filled box opens the picture.
  return html`<div className="rjBoxes">
    ${items.map((p) => html`<div key=${p.id} className="rjBox" title="התמונה המלאה נפתחת בלחיצה מתוך ה-PDF">
      <img src=${p.thumb} alt="" /><button type="button" className="x" title="הסרה" onClick=${(e) => { e.stopPropagation(); remove(p); }}>×</button></div>`)}
    <div className="rjBox" tabIndex="0" onPaste=${onPaste} title="לחיצה על הריבוע ואז Ctrl+V, מקש ימני — או העלאה/צילום"
      onContextMenu=${imgPickProps({ projectId, multiple: true, onFile: (fs) => add(fs) }).onContextMenu}
      onClick=${(e) => e.currentTarget.focus()}>
      <span className="hint">${busy > 0 ? "מעלה…" : items.length ? "+ תמונה נוספת" : "הדבקה / העלאה"}</span>
      <div className="acts">
        <button type="button" title="העלאת תמונה — מהמחשב או מהמאגר" onClick=${(e) => imgAsk(e, { projectId, multiple: true, onFile: (fs) => add(fs) })}><${Upload} size=${12} /></button>
        ${!noCamera && html`<button type="button" title="צילום" onClick=${(e) => { e.stopPropagation(); camRef.current && camRef.current.click(); }}><${Camera} size=${12} /></button>`}
      </div>
    </div>
    <input ref=${fileRef} type="file" accept="image/*" multiple style=${{ display: "none" }} onChange=${(e) => { add(e.target.files); e.target.value = ""; }} />
    ${!noCamera && html`<input ref=${camRef} type="file" accept="image/*" capture="environment" style=${{ display: "none" }} onChange=${(e) => { add(e.target.files); e.target.value = ""; }} />`}
  </div>`;
}

// ----------------------------------------------------------------------------- notes, each with its date
function Notes({ notes, onChange }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange((cur) => cur.concat([{ id: uid("n"), at: today(), text: t }]));
    setText("");
  };
  return html`<div>
    ${notes.map((n) => html`<div key=${n.id} className="note"><b>${fmt(n.at)}</b><span>${n.text}</span>
      <button type="button" title="מחיקת ההערה" onClick=${() => { if (confirm("למחוק את ההערה?")) onChange((cur) => cur.filter((x) => x.id !== n.id)); }}>×</button></div>`)}
    <div className="noteAdd">
      <input className="lliIn" placeholder="הערה חדשה" value=${text} onChange=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      <button type="button" className="rjBtn icon" title="הוספת הערה" disabled=${!text.trim()} onClick=${add}><${Plus} size=${14} strokeWidth=${2.4} /></button>
    </div>
  </div>`;
}

// ----------------------------------------------------------------------------- printing (landscape, house paper)
// 03.11.26 (rejects build 3) — her notes on the printout:
//  · the date (and attendees) sit in the main heading; no second blue band
//  · A. Weiss navy, not the project colour
//  · light-grey column lines as well as row lines
//  · description and notes narrower, the photos wider and as many to a line as
//    fit, half the gap between them
//  · a row never cut by the foot of the page: a row with many photos is printed
//    in pieces, and every piece repeats the number, floor, description and the
//    rest, so nothing is left blank on the next page
//  · every photo is a link to the full picture (a signed link valid 12 months)
const WEISS_NAVY = "#1A559E";        // BRAND_PALETTES "navy" — the submittal form and the contacts sheet
const WEISS_NAVY_INK = "#103460";
const PHOTOS_PER_PIECE = 8;          // two lines of four: the tallest a piece of a row may be
// 03.11.26 — a photo link is valid until the end of the project (its end date in
// the project settings, to the end of that day). A project with no end date, or
// one already past it, gets twelve months.
const YEAR_SECONDS = 365 * 24 * 3600;
function linkSeconds(projectEnd) {
  const m = String(projectEnd || "").match(/^(\d{4})-(\d{2})-(\d{2})/) || String(projectEnd || "").match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return YEAR_SECONDS;
  const end = m[1].length === 4 ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : new Date(+m[3], +m[2] - 1, +m[1], 23, 59, 59);
  const secs = Math.floor((end.getTime() - Date.now()) / 1000);
  return secs > 3600 ? secs : YEAR_SECONDS;
}
function rowsFor(l, rowPick) {
  const all = (l.rows || []).map((r, i) => ({ ...r, n: i + 1 }));
  // rowPick: the ids for every list, or { listId: ids } — a list with none prints whole
  const ids = rowPick && !Array.isArray(rowPick) ? rowPick[l.id] : rowPick;
  return ids && ids.length ? all.filter((r) => ids.indexOf(r.id) >= 0) : all;
}
// dates isolated left-to-right, so a Hebrew line does not turn 03/11/2026 round
const ltr = (s) => `⁦${s}⁩`;
function infoLine(l) {
  return [l.list_date ? `תאריך: ${ltr(fmt(l.list_date))}` : "", attText(l) ? `נוכחים: ${attText(l)}` : ""]
    .filter(Boolean).join("  ·  ");
}
function secTitle(l) { return [l.name || "ללא שם", infoLine(l)].filter(Boolean).join("  ·  "); }
// A row with more photos (or plans) than fit in one piece becomes several pieces.
function piecesOf(r, per, perPlans) {
  const P = per || PHOTOS_PER_PIECE, Q = perPlans || P;
  const ph = r.photos || [], pl = r.plans || [];
  const n = Math.max(1, Math.ceil(ph.length / P), Math.ceil(pl.length / Q));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ ...r, photos: ph.slice(i * P, (i + 1) * P),
      plans: pl.slice(i * Q, (i + 1) * Q), cont: i > 0 });
  }
  return out;
}
async function signedLinks(lists, rowPick, projectEnd) {
  const paths = [];
  lists.forEach((l) => rowsFor(l, rowPick).forEach((r) => (r.photos || []).concat(r.plans || []).forEach((p) => { if (p && p.path) paths.push(p.path); })));
  const out = {};
  const secs = linkSeconds(projectEnd);
  for (let i = 0; i < paths.length; i += 100) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), secs);
      if (error) console.warn("[rejects] links", error);
      (data || []).forEach((d) => { if (d && d.path && d.signedUrl) out[d.path] = d.signedUrl; });
    } catch (e) { console.warn("[rejects] links", e); }
  }
  // 12.11.26 (build 18) — a photo the batch did not sign is signed on its own;
  // without a link the PDF would fall back to the small thumbnail (a blur).
  for (const pth of paths) {
    if (out[pth]) continue;
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pth, secs);
      if (data && data.signedUrl) out[pth] = data.signedUrl; else console.warn("[rejects] link", pth, error);
    } catch (e) { console.warn("[rejects] link", pth, e); }
  }
  const miss = paths.filter((x) => !out[x]).length;
  console.info("[rejects] print links", paths.length - miss, "of", paths.length);
  return out;
}
// A row printed in pieces is put back together wherever two pieces of it landed
// on the same page: "המשך" is only for a row the page really cut. It runs at the
// moment the shared paginator says the pages are final, before anything prints.
const MERGE_JS = `<script>
(function () {
  var v = false;
  function merge() {
    Array.prototype.forEach.call(document.querySelectorAll("#pages tbody"), function (tb) {
      Array.prototype.slice.call(tb.querySelectorAll("tr.contRow")).forEach(function (tr) {
        var prev = tr.previousElementSibling;
        if (!prev || prev.getAttribute("data-rid") !== tr.getAttribute("data-rid")) return;
        ["c-photos", "c-plans"].forEach(function (k) {
          var from = tr.querySelector("td." + k + " .phs"), to = prev.querySelector("td." + k + " .phs");
          if (from && to) while (from.firstChild) to.appendChild(from.firstChild);
        });
        tr.remove();
      });
    });
  }
  Object.defineProperty(window, "__awPaged", { configurable: true,
    get: function () { return v; },
    // the full photos come over the network: the printout waits until every
    // one has arrived (up to two minutes), so none prints blank
    set: function (x) {
      if (x === true && !v) {
        try { merge(); } catch (e) {}
        var left = Array.prototype.filter.call(document.querySelectorAll("#pages img"), function (im) { return !im.complete; });
        if (left.length) {
          var n = left.length, fin = false;
          var end = function () { if (!fin) { fin = true; v = true; } };
          left.forEach(function (im) { var one = function () { if (--n <= 0) end(); }; im.addEventListener("load", one); im.addEventListener("error", one); });
          setTimeout(end, 120000);
          return;
        }
      }
      v = x;
    } });
})();
<\/script>`;
// 11.11.26 (build 13) — the layout of the printout is hers to set, per page
// direction: the share of the width each column takes (dragged on the bar in
// the "פריסה" panel) and how many photos go in one line. The photos then grow
// to fill their column, so no white space is left beside them.
const LAYOUT_DEFAULT = {
  landscape: { n: 3.2, floor: 4.5, desc: 17, owner: 8, due: 7, photos: 44, photosWithPlans: 34, plans: 12, notes: 12, done: 4 },
  portrait: { n: 4.2, floor: 5.8, desc: 20, owner: 9, due: 8.5, photos: 38, photosWithPlans: 31, plans: 10, notes: 14, done: 4.8 },
};
const PER_LINE_DEFAULT = 3;
// the page geometry of printSheetCss: paper less the white edge, the frame's padding and border
const pageGeom = (wide) => wide ? { marginMm: 7, padX: 5, framePad: "3mm 5mm", contentMm: 297 - 14 - 10 - 3 } : { marginMm: 6, padX: 4, framePad: "3mm 4mm", contentMm: 210 - 12 - 8 - 3 };
function layoutLoad(orient) {
  try { const v = JSON.parse(localStorage.getItem("rj-print-layout-" + orient) || "null"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; }
}
function layoutSave(orient, v) { try { localStorage.setItem("rj-print-layout-" + orient, JSON.stringify(v || {})); } catch (e) {} }
// The printed columns, each with its share of the width (shares sum to 100).
export function printColumns(lists, wide, layout) {
  const on = {};
  COLS.forEach(([k]) => { on[k] = lists.some((l) => colsOf(l)[k] !== false); });
  const D = LAYOUT_DEFAULT[wide ? "landscape" : "portrait"];
  const mine = (layout && layout.w) || {};
  const label = { n: "מס\"ד", floor: "קומה", desc: "תיאור", owner: "אחריות", due: wide ? "מועד לביצוע" : "מועד ביצוע", photos: "תמונות", plans: "תוכנית", notes: "הערות", done: "טופל" };
  const cols = COLS.filter(([k]) => on[k]).map(([k]) => {
    const d = k === "photos" && on.plans ? D.photosWithPlans : D[k];
    return [k, label[k], mine[k] > 0 ? mine[k] : d];
  });
  const total = cols.reduce((a, c) => a + c[2], 0) || 1;
  return cols.map((c) => [c[0], c[1], (c[2] / total) * 100]);
}
// How large a photo may be in a column of the given share: k to a line, filling it.
function photoBox(sharePct, wide, k) {
  const px = (pageGeom(wide).contentMm * sharePct / 100) * 96 / 25.4 - 8;   // less the cell's padding and lines
  const w = Math.max(36, Math.min(320, Math.floor((px - 2 * (k - 1)) / k) - 2));
  return { w, h: Math.round(w * 0.77) };
}

export async function printLists({ lists, rowPick, projectName, projectEnd, brand, paginateJs, whenPaged, landscape = true, layout, docOnly }) {
  const only = !!(docOnly || printLists.docOnly);
  // 11.11.26 — upright (portrait) is a narrower page: the text columns take a
  // larger share, the photos are smaller (three to a line, two lines to a piece).
  const wide = landscape !== false;
  // The window opens on the click itself; a window opened after an await is one
  // the browser blocks as a pop-up.
  const w = only ? null : window.open("", "_blank");
  if (w) { try { w.document.write('<p dir="rtl" style="font-family:Arial;padding:24px">מכין את ה-PDF…</p>'); } catch (e) {} }
  const links = only ? {} : await signedLinks(lists, rowPick, projectEnd);
  const b = brand || {};
  const acc = WEISS_NAVY;
  const single = lists.length === 1;
  const cols = printColumns(lists, wide, layout);
  const geo = pageGeom(wide);
  const perLine = Math.max(1, Math.min(6, +((layout && layout.per) || PER_LINE_DEFAULT)));
  const share = (k) => { const c = cols.find((x) => x[0] === k); return c ? c[2] : 0; };
  const phBox = photoBox(share("photos") || 30, wide, perLine);
  // plans: as many to a line as fit at the size of a photo, at least one
  const plansPer = Math.max(1, Math.min(perLine, Math.floor(((geo.contentMm * share("plans") / 100) * 96 / 25.4 - 8) / (phBox.w + 4)) || 1));
  const plBox = photoBox(share("plans") || 10, wide, plansPer);
  const colg = cols.map((c) => `<col style="width:${c[2].toFixed(2)}%">`).join("");
  const imgs = (arr, cls) => (arr || []).map((p) => {
    // 12.11.26 (build 15) — the PDF carries the full photo (1600px, the copy in
    // storage), not the 480px thumbnail kept on the row: zoomed in, the
    // thumbnail was a blur and a plan could not be read. The thumbnail is only
    // the fallback for a photo whose upload never reached storage.
    const url = p.path && links[p.path];
    const im = `<img class="ph ${cls || ""}" src="${url || p.thumb}" alt="">`;
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${im}</a>` : im;
  }).join("");
  const cell = (r, k) => {
    if (k === "n") return `${r.n}${r.cont ? '<div class="cont">המשך</div>' : ""}`;
    if (k === "due") return r.due ? `<span dir="ltr">${fmt(r.due)}</span>` : "";
    if (k === "photos") return `<div class="phs">${imgs(r.photos)}</div>`;
    if (k === "plans") return `<div class="phs">${imgs(r.plans, "pl")}</div>`;
    if (k === "notes") return (r.notes || []).map((n) => `<div class="nt"><b dir="ltr">${fmt(n.at)}</b> ${esc(n.text)}</div>`).join("");
    if (k === "done") return r.done ? "✓" : "";
    return esc(r[k]).replace(/\n/g, "<br>");
  };
  // One list: no band — its name, date and attendees are the heading. Several:
  // a quiet grey band names each one, and each starts on its own page.
  const body = lists.map((l) => rowsFor(l, rowPick).flatMap((r) => piecesOf(r, perLine * 2, plansPer * 2)).map((r) =>
    `<tr data-rid="${esc(l.id + ":" + r.id)}"${single ? "" : ` data-sec="${esc(secTitle(l))}"`} class="${[r.done ? "ok" : "", r.cont ? "contRow" : ""].join(" ").trim()}">${cols.map((c) => `<td class="c-${c[0]}">${cell(r, c[0])}</td>`).join("")}</tr>`).join("")).join("");
  const logo = b.logoUrl ? `<img src="${b.logoUrl}" alt="logo">` : "<span></span>";
  const clientLogo = b.clientLogoUrl ? `<img class="clientLogo" src="${b.clientLogoUrl}" alt="logo">` : "<span></span>";
  const footBlock = b.footerImg ? `<div class="footImg" id="footimg"><img src="${b.footerImg}" alt="footer"></div>` : "";
  const title = single ? (lists[0].name || "סיכומי פגישה / ריג'קטים") : "סיכומי פגישה / ריג'קטים";
  // Under the subject: the date in the subject's colour, then the attendees.
  const l0 = single ? lists[0] : null;
  const dateLine = l0 && l0.list_date ? `תאריך: ${ltr(fmt(l0.list_date))}` : "";
  // 11.11.26 — under the heading, before its grey line: who was there (right)
  // and the general summary (left), on the first page only; either one that is
  // empty is left out, and the other takes the whole width.
  const ppl0 = l0 ? filledPeople(l0) : [];
  const sum0 = l0 ? summaryOf(l0) : "";
  const pplHtml = ppl0.length ? `<div class="minCell"><div class="minTtl">נוכחים:</div>${ppl0.map((p) =>
    `<div class="minLine">${p.g.trim() && p.n.trim() ? `<b>${esc(p.g.trim())}</b> - ${esc(p.n.trim())}` : esc(p.g.trim() || p.n.trim())}</div>`).join("")}</div>` : "";
  const sumHtml = sum0 ? `<div class="minCell"><div class="minTtl">סיכום כללי:</div><div class="minTxt">${esc(sum0).replace(/\n/g, "<br>")}</div></div>` : "";
  const minBlock = pplHtml || sumHtml ? `<div class="sumRow minRow${pplHtml && sumHtml ? " two" : ""}">${pplHtml}${sumHtml}</div>` : "";
  const doc = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(`${projectName || ""} - ${title}`)}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Inter:wght@500;600;700&display=swap');
${printSheetCss({ landscape: wide, accent: acc, marginMm: geo.marginMm, framePad: geo.framePad })}
body { font-family: 'Assistant', 'Inter', Arial, sans-serif; color: #17181c; direction: rtl; }
.hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; border-bottom: 2.5px solid #d5d9df; padding-bottom: 6px; margin-bottom: 6px; }
.hdr img { max-height: 40px; max-width: 140px; object-fit: contain; justify-self: start; }
.hdr img.clientLogo { justify-self: end; }
.ttlWrap { grid-column: 2; text-align: center; }
.ttlWrap .ttl { font-size: 17px; font-weight: 800; color: ${WEISS_NAVY_INK}; }
.ttlWrap .sub { font-size: 11.5px; font-weight: 700; color: ${acc}; margin-top: 2px; }
.ttlWrap .dt { font-size: 11px; font-weight: 700; color: ${acc}; margin-top: 2px; }
.ttlWrap .inf { font-size: 10.5px; font-weight: 600; color: #3d4350; margin-top: 2px; }
.pgSec { font-size: 10.5px; font-weight: 800; color: ${WEISS_NAVY_INK}; background: #eef1f5; border: 1px solid #dfe3ea; padding: 3px 8px; border-radius: 5px; margin: 0 0 4px; text-align: center; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th { background: ${acc}; color: #fff; font-size: ${wide ? 9.5 : 8.5}px; font-weight: 800; padding: 5px 3px; border: 1px solid ${acc}; }
td { font-size: ${wide ? 9 : 8.5}px; padding: 3px; border: 1px solid #e3e6eb; text-align: center; vertical-align: middle; word-break: break-word; }
.minRow { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr; gap: 0; background: #eef1f5; border: 1px solid #dfe3ea; border-radius: 5px; margin-top: 4px; text-align: right; }
.minRow.two { grid-template-columns: 1fr 1fr; }
.minRow.two .minCell + .minCell { border-inline-start: 1px solid #d5d9df; }
.minCell { padding: 4px 9px; font-size: 10px; color: #17181c; line-height: 1.45; }
.minTtl { font-weight: 800; font-size: 10.5px; color: #000; margin-bottom: 1px; }
.minLine b { font-weight: 700; }
tr.ok td { background: #e3f3e6; }
.phs { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px; }
.phs a { display: block; line-height: 0; }
img.ph { width: ${phBox.w}px; height: ${phBox.h}px; object-fit: contain; border: 1px solid #e6e8ec; border-radius: 2px; background: #fff; display: block; }
img.ph.pl { width: ${plBox.w}px; height: ${plBox.h}px; }
.cont { font-size: 7.5px; color: #6b7280; font-weight: 600; }
.nt { margin-bottom: 2px; text-align: center; } .nt b { color: #5b5e66; unicode-bidi: isolate; }
.awTip { position: fixed; top: 0; left: 0; right: 0; z-index: 99; background: #fff7e0; border-bottom: 1px solid #e7c76a; color: #5b4300; font-size: 13px; font-weight: 600; text-align: center; padding: 7px 10px; direction: rtl; }
@media print { .awTip { display: none !important; } }
</style></head><body>${only ? "" : `<div class="awTip">בחלון ההדפסה, ביעד, בחרי <b>"שמירה כ-PDF" / "Save as PDF"</b>. מדפסת PDF אחרת (כמו Foxit) מקטינה את התמונות ומוחקת את הקישורים שלהן.</div>`}<div id="src">
<div class="hdr">${logo}<div class="ttlWrap"><div class="ttl">${esc(projectName || "")}</div><div class="sub">${esc(title)}</div>${dateLine ? `<div class="dt">${esc(dateLine)}</div>` : ""}</div>${clientLogo}${minBlock}</div>
<table><colgroup>${colg}</colgroup><thead><tr>${cols.map((c) => `<th>${esc(c[1])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
${footBlock}</div><div id="pages"></div>${MERGE_JS}${paginateJs ? paginateJs(printedStampText("he")) : ""}</body></html>`;
  if (only) return doc;
  if (!w) return;
  w.document.open(); w.document.write(doc); w.document.close(); w.focus();
  // 12.11.26 — the full photos take longer than the shared 12-second wait: the
  // print dialog opens when the pages are final and every photo has arrived
  // (MERGE_JS holds __awPaged back until then), at most two and a half minutes.
  const t0 = Date.now();
  const tick = () => {
    let ready = false;
    try { ready = !!w.__awPaged; } catch (e) { ready = true; }
    if (ready || Date.now() - t0 > 150000) { setTimeout(() => { try { w.print(); } catch (e) {} }, 300); return; }
    setTimeout(tick, 200);
  };
  setTimeout(tick, 300);
}

// ----------------------------------------------------------------------------- Excel: one sheet per list
export async function excelLists({ lists, rowPick, projectName }) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = {};
  lists.forEach((l) => {
    const c = colsOf(l);
    const head = [].concat(c.n ? ["מס\"ד"] : [], c.floor ? ["קומה"] : [], c.desc ? ["תיאור"] : [], c.owner ? ["אחריות"] : [], c.due ? ["מועד לביצוע"] : [],
      c.photos ? ["תמונות"] : [], c.plans ? ["תוכנית"] : [], c.notes ? ["הערות"] : [], c.done ? ["טופל"] : []);
    const top = [[l.name || "ללא שם"]];
    if (l.list_date) top.push([`תאריך: ${fmt(l.list_date)}`]);
    const ppl = filledPeople(l);
    if (ppl.length) { top.push(["נוכחים:"]); ppl.forEach((p) => top.push([personLine(p)])); }
    if (summaryOf(l)) { top.push(["סיכום כללי:"]); top.push([summaryOf(l)]); }
    top.push([]);
    const body = rowsFor(l, rowPick).map((r) => [].concat(c.n ? [r.n] : [],
      c.floor ? [r.floor || ""] : [], c.desc ? [r.desc || ""] : [], c.owner ? [r.owner || ""] : [], c.due ? [fmt(r.due)] : [],
      c.photos ? [(r.photos || []).length ? `${(r.photos || []).length} תמונות` : ""] : [],
      c.plans ? [(r.plans || []).length ? `${(r.plans || []).length} תוכניות` : ""] : [],
      c.notes ? [(r.notes || []).map((n) => `${fmt(n.at)} ${n.text}`).join("\n")] : [],
      c.done ? [r.done ? "טופל" : ""] : []));
    const ws = XLSX.utils.aoa_to_sheet(top.concat([head], body));
    ws["!cols"] = head.map((h) => ({ wch: h === "תיאור" || h === "הערות" ? 45 : 14 }));
    ws["!views"] = [{ RTL: true }];
    let nm = String(l.name || "רשימה").replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "רשימה";
    while (used[nm]) nm = nm.slice(0, 25) + " " + (Object.keys(used).length + 1);
    used[nm] = true;
    XLSX.utils.book_append_sheet(wb, ws, nm);
  });
  if (!wb.SheetNames.length) return;
  wb.Workbook = { Views: [{ RTL: true }] };
  const file = `${String(projectName || "").replace(/[\\/:*?"<>|]+/g, " ").trim()} - סיכומי פגישה - ריג'קטים - ${today()}.xlsx`.replace(/^ - /, "");
  XLSX.writeFile(wb, file);
}
