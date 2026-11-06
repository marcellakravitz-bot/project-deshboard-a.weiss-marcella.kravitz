// =============================================================================
//  rejects/admin.js — ריג'קטים (punch lists, floor hand-overs, meeting notes)
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
  Plus, Printer, FileDown, FileSpreadsheet, Trash2, Camera, Upload, ClipboardPaste, X, ChevronDown, ChevronLeft, Save,
} from "lucide-react";
import { supabase, printSheetCss, printedStampText, imgPickProps, imgAsk } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;
export const REJECTS_BUILD = "rejects build 11 · 06.11.2026";
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
// One photo: a 1600px copy to storage, a 480px thumbnail kept on the row.
async function storePhoto(projectId, listId, file) {
  const im = await loadImg(file);
  const thumb = shrink(im, 480, 0.72).toDataURL("image/jpeg", 0.72);
  const big = await new Promise((r) => shrink(im, 1600, 0.82).toBlob(r, "image/jpeg", 0.82));
  const path = `${projectId}/rejects/${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, big, { contentType: "image/jpeg", upsert: false });
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
.rj .rjHead{display:grid;grid-template-columns:2fr 1fr 3fr;gap:10px;background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:10px 12px;margin:8px 0}
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
export function RejectsBoard({ projectId, projectName, projectEnd, printParts, currentEmail, subs }) {
  const [lists, setLists] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);
  const [picked, setPicked] = useState({});           // lists ticked for print / export
  // 05.11.26 — every row prints until its V is taken off; a row without its V
  // stays editable but is greyed.
  const [rowOff, setRowOff] = useState({});           // listId -> { rowId: true }: rows taken out of print
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
      id: l.id, project_id: projectId, name: l.name || "", list_date: l.list_date || null, attendees: l.attendees || "",
      rows: l.rows || [], cols: l.cols || {}, viewers: l.viewers || [], created_at: l.created_at, updated_at: new Date().toISOString(), updated_by: currentEmail || null,
    }, { onConflict: "id" });
    if (run !== runs.current[id]) return;
    if (error) { dirty.current[id] = true; setErr("השמירה נכשלה: " + (error.message || "")); setSaveState(""); return; }
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
  const doPrint = () => printLists({ lists: forOut, rowPick: pickMap, projectName, projectEnd, ...(printParts || {}) });
  const doExcel = () => excelLists({ lists: forOut, rowPick: pickMap, projectName }).catch((e) => flash("הייצוא נכשל: " + (e.message || e)));
  const allPicked = lists.length > 0 && lists.every((l) => picked[l.id]);

  return html`<div className="rj" dir="rtl"><style>${css}</style>
    <div className="rjTop">
      <button type="button" className="rjBtn primary" onClick=${addList}><${Plus} size=${15} strokeWidth=${2.4} /><span className="lbl">רשימה חדשה</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${doPrint}
        title=${nOut ? "PDF לרוחב — הרשימות והשורות המסומנות" : "PDF לרוחב — כל הרשימות"}>
        <${FileDown} size=${15} /><span className="lbl">PDF${nOut ? ` (${nOut})` : ""}</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${doExcel}
        title=${nOut ? "אקסל — הרשימות והשורות המסומנות" : "אקסל — כל הרשימות"}>
        <${FileSpreadsheet} size=${15} /><span className="lbl">אקסל${nOut ? ` (${nOut})` : ""}</span></button>
    </div>
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
      <label>נוכחים בסיור<input className="lliIn" style=${{ textAlign: "start", fontSize: 13 }} value=${list.attendees || ""} onChange=${(e) => edit((l) => ({ ...l, attendees: e.target.value }))} /></label>
    </div>
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
  const add = async (files) => {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type || "image/"));
    if (!list.length) return;
    setBusy((b) => b + list.length);
    for (const f of list) {
      try {
        const p = await storePhoto(projectId, listId, f);
        if (!p.path) flash("התמונה נשמרה בתצוגה מוקטנת בלבד — העלאה לאחסון נכשלה");
        rowEdit((cur) => cur.concat([p]));
      } catch (e) { flash("הוספת התמונה נכשלה"); }
      setBusy((b) => b - 1);
    }
  };
  const onPaste = (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) { e.preventDefault(); add(files); }
  };
  const remove = (p) => {
    if (!confirm("להסיר את התמונה?")) return;
    if (p.path) supabase.storage.from(BUCKET).remove([p.path]).catch(() => {});
    rowEdit((cur) => cur.filter((x) => x.id !== p.id));
  };
  // A box per picture, and always one empty box after them: click it, then
  // Ctrl+V — or the two small buttons inside it. A filled box opens the picture.
  return html`<div className="rjBoxes">
    ${items.map((p) => html`<div key=${p.id} className="rjBox" title="פתיחה בגודל מלא" onClick=${() => openPhoto(p)}>
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
  return [l.list_date ? `תאריך: ${ltr(fmt(l.list_date))}` : "", (l.attendees || "").trim() ? `נוכחים בסיור: ${l.attendees.trim()}` : ""]
    .filter(Boolean).join("  ·  ");
}
function secTitle(l) { return [l.name || "ללא שם", infoLine(l)].filter(Boolean).join("  ·  "); }
// A row with more photos (or plans) than fit in one piece becomes several pieces.
function piecesOf(r) {
  const ph = r.photos || [], pl = r.plans || [];
  const n = Math.max(1, Math.ceil(Math.max(ph.length, pl.length) / PHOTOS_PER_PIECE));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ ...r, photos: ph.slice(i * PHOTOS_PER_PIECE, (i + 1) * PHOTOS_PER_PIECE),
      plans: pl.slice(i * PHOTOS_PER_PIECE, (i + 1) * PHOTOS_PER_PIECE), cont: i > 0 });
  }
  return out;
}
async function signedLinks(lists, rowPick, projectEnd) {
  const paths = [];
  lists.forEach((l) => rowsFor(l, rowPick).forEach((r) => (r.photos || []).concat(r.plans || []).forEach((p) => { if (p && p.path) paths.push(p.path); })));
  const out = {};
  for (let i = 0; i < paths.length; i += 100) {
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), linkSeconds(projectEnd));
      (data || []).forEach((d) => { if (d && d.path && d.signedUrl) out[d.path] = d.signedUrl; });
    } catch (e) { console.warn("[rejects] links", e); }
  }
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
    set: function (x) { if (x === true && !v) { try { merge(); } catch (e) {} } v = x; } });
})();
<\/script>`;
export async function printLists({ lists, rowPick, projectName, projectEnd, brand, paginateJs, whenPaged }) {
  // The window opens on the click itself; a window opened after an await is one
  // the browser blocks as a pop-up.
  const w = printLists.docOnly ? null : window.open("", "_blank");
  if (w) { try { w.document.write('<p dir="rtl" style="font-family:Arial;padding:24px">מכין את ה-PDF…</p>'); } catch (e) {} }
  const links = printLists.docOnly ? {} : await signedLinks(lists, rowPick, projectEnd);
  const b = brand || {};
  const acc = WEISS_NAVY;
  const single = lists.length === 1;
  const on = {};
  COLS.forEach(([k]) => { on[k] = lists.some((l) => colsOf(l)[k] !== false); });
  const cols = [];
  if (on.n) cols.push(["n", "מס\"ד", 3.2]);
  if (on.floor) cols.push(["floor", "קומה", 4.5]);
  if (on.desc) cols.push(["desc", "תיאור", 17]);
  if (on.owner) cols.push(["owner", "אחריות", 8]);
  if (on.due) cols.push(["due", "מועד לביצוע", 7]);
  if (on.photos) cols.push(["photos", "תמונות", on.plans ? 34 : 44]);
  if (on.plans) cols.push(["plans", "תוכנית", 12]);
  if (on.notes) cols.push(["notes", "הערות", 12]);
  if (on.done) cols.push(["done", "טופל", 4]);
  const total = cols.reduce((a, c) => a + c[2], 0);
  const colg = cols.map((c) => `<col style="width:${((c[2] / total) * 100).toFixed(2)}%">`).join("");
  const imgs = (arr) => (arr || []).map((p) => {
    const im = `<img class="ph" src="${p.thumb}" alt="">`;
    const url = p.path && links[p.path];
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${im}</a>` : im;
  }).join("");
  const cell = (r, k) => {
    if (k === "n") return `${r.n}${r.cont ? '<div class="cont">המשך</div>' : ""}`;
    if (k === "due") return r.due ? `<span dir="ltr">${fmt(r.due)}</span>` : "";
    if (k === "photos") return `<div class="phs">${imgs(r.photos)}</div>`;
    if (k === "plans") return `<div class="phs">${imgs(r.plans)}</div>`;
    if (k === "notes") return (r.notes || []).map((n) => `<div class="nt"><b dir="ltr">${fmt(n.at)}</b> ${esc(n.text)}</div>`).join("");
    if (k === "done") return r.done ? "✓" : "";
    return esc(r[k]).replace(/\n/g, "<br>");
  };
  // One list: no band — its name, date and attendees are the heading. Several:
  // a quiet grey band names each one, and each starts on its own page.
  const body = lists.map((l) => rowsFor(l, rowPick).flatMap(piecesOf).map((r) =>
    `<tr data-rid="${esc(l.id + ":" + r.id)}"${single ? "" : ` data-sec="${esc(secTitle(l))}"`} class="${[r.done ? "ok" : "", r.cont ? "contRow" : ""].join(" ").trim()}">${cols.map((c) => `<td class="c-${c[0]}">${cell(r, c[0])}</td>`).join("")}</tr>`).join("")).join("");
  const logo = b.logoUrl ? `<img src="${b.logoUrl}" alt="logo">` : "<span></span>";
  const clientLogo = b.clientLogoUrl ? `<img class="clientLogo" src="${b.clientLogoUrl}" alt="logo">` : "<span></span>";
  const footBlock = b.footerImg ? `<div class="footImg" id="footimg"><img src="${b.footerImg}" alt="footer"></div>` : "";
  const title = single ? (lists[0].name || "ריג'קטים") : "ריג'קטים";
  // Under the subject: the date in the subject's colour, then the attendees.
  const l0 = single ? lists[0] : null;
  const dateLine = l0 && l0.list_date ? `תאריך: ${ltr(fmt(l0.list_date))}` : "";
  const attLine = l0 && (l0.attendees || "").trim() ? `נוכחים בסיור: ${l0.attendees.trim()}` : "";
  const doc = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(`${projectName || ""} - ${title}`)}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Inter:wght@500;600;700&display=swap');
${printSheetCss({ landscape: true, accent: acc, marginMm: 7, framePad: "3mm 5mm" })}
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
th { background: ${acc}; color: #fff; font-size: 9.5px; font-weight: 800; padding: 5px 3px; border: 1px solid ${acc}; }
td { font-size: 9px; padding: 3px; border: 1px solid #e3e6eb; text-align: center; vertical-align: top; word-break: break-word; }
td.c-desc, td.c-notes { text-align: right; }
tr.ok td { background: #e3f3e6; }
.phs { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px; }
.phs a { display: block; line-height: 0; }
img.ph { width: 104px; height: 80px; object-fit: contain; border: 1px solid #e6e8ec; border-radius: 2px; background: #fff; display: block; }
.cont { font-size: 7.5px; color: #6b7280; font-weight: 600; }
.nt { margin-bottom: 2px; } .nt b { color: #5b5e66; unicode-bidi: isolate; }
</style></head><body><div id="src">
<div class="hdr">${logo}<div class="ttlWrap"><div class="ttl">${esc(projectName || "")}</div><div class="sub">${esc(title)}</div>${dateLine ? `<div class="dt">${esc(dateLine)}</div>` : ""}${attLine ? `<div class="inf">${esc(attLine)}</div>` : ""}</div>${clientLogo}</div>
<table><colgroup>${colg}</colgroup><thead><tr>${cols.map((c) => `<th>${esc(c[1])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
${footBlock}</div><div id="pages"></div>${MERGE_JS}${paginateJs ? paginateJs(printedStampText("he")) : ""}</body></html>`;
  if (printLists.docOnly) return doc;
  if (!w) return;
  w.document.open(); w.document.write(doc); w.document.close(); w.focus();
  if (whenPaged) whenPaged(w, 300); else setTimeout(() => { try { w.print(); } catch (e) {} }, 800);
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
    if ((l.attendees || "").trim()) top.push([`נוכחים בסיור: ${l.attendees.trim()}`]);
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
  const file = `${String(projectName || "").replace(/[\\/:*?"<>|]+/g, " ").trim()} - ריג'קטים - ${today()}.xlsx`.replace(/^ - /, "");
  XLSX.writeFile(wb, file);
}
