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
  Plus, Printer, FileSpreadsheet, Trash2, Camera, Upload, ClipboardPaste, X, ChevronDown, ChevronLeft, Save,
} from "lucide-react";
import { supabase, printSheetCss, printedStampText } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;
export const REJECTS_BUILD = "rejects build 1 · 03.11.2026";
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
@media (max-width:760px){.rj .rjHead{grid-template-columns:1fr}.rj .rjBtn .lbl{display:none}}
`;

// ----------------------------------------------------------------------------- the module
export function RejectsBoard({ projectId, projectName, printParts, currentEmail, subs }) {
  const [lists, setLists] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);
  const [picked, setPicked] = useState({});           // lists ticked for print / export
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

  const chosen = lists.filter((l) => picked[l.id]);
  const forOut = chosen.length ? chosen : lists;
  const doPrint = (ls, rowPick) => printLists({ lists: ls, rowPick, projectName, ...(printParts || {}) });
  const doExcel = (ls, rowPick) => excelLists({ lists: ls, rowPick, projectName }).catch((e) => flash("הייצוא נכשל: " + (e.message || e)));
  const allPicked = lists.length > 0 && chosen.length === lists.length;

  return html`<div className="rj" dir="rtl"><style>${css}</style>
    <div className="rjBar">
      <span className="rjTitle">ריג'קטים${projectName ? ` · ${projectName}` : ""}</span>
      <button type="button" className="rjBtn primary" onClick=${addList}><${Plus} size=${15} strokeWidth=${2.4} /><span className="lbl">רשימה חדשה</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${() => doPrint(forOut)} title=${chosen.length ? "הדפסת הרשימות המסומנות" : "הדפסת כל הרשימות"}>
        <${Printer} size=${15} /><span className="lbl">הדפסה${chosen.length ? ` (${chosen.length})` : ""}</span></button>
      <button type="button" className="rjBtn" disabled=${!lists.length} onClick=${() => doExcel(forOut)} title=${chosen.length ? "אקסל לרשימות המסומנות" : "אקסל לכל הרשימות"}>
        <${FileSpreadsheet} size=${15} /><span className="lbl">אקסל${chosen.length ? ` (${chosen.length})` : ""}</span></button>
      <button type="button" className="rjBtn" onClick=${saveAll}><${Save} size=${15} /><span className="lbl">שמירה</span></button>
      ${saveState === "saving" && html`<span className="rjSaved" style=${{ color: "#5b5e66" }}>שומר…</span>`}
      ${saveState === "saved" && html`<span className="rjSaved">נשמר ✓</span>`}
    </div>
    ${err && html`<p className="rjErr">${err}</p>`}
    <div className="rjWin"><table>
      <thead><tr>
        <th style=${{ width: 36 }}><input type="checkbox" title="סימון הכול" checked=${allPicked}
          onChange=${(e) => setPicked(e.target.checked ? Object.fromEntries(lists.map((l) => [l.id, true])) : {})} /></th>
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
              <${ListEditor} list=${l} projectId=${projectId} subs=${subs || []} edit=${(fn) => editList(l.id, fn)} flash=${flash}
                onPrint=${(rowPick) => doPrint([l], rowPick)} onExcel=${(rowPick) => doExcel([l], rowPick)} />
            </td></tr>`}
          <//>`;
        })}
      </tbody>
    </table></div>
    ${toast && html`<div className="rjToast">${toast}</div>`}
  </div>`;
}

// ----------------------------------------------------------------------------- one list
function ListEditor({ list, projectId, subs, edit, flash, onPrint, onExcel }) {
  const [pick, setPick] = useState({});
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
  const picked = rows.filter((r) => pick[r.id]).map((r) => r.id);
  const rowPick = picked.length ? picked : null;
  const thV = (k, label) => html`<th key=${k}><div className="thV">${label}
    <input type="checkbox" title="להדפסה" checked=${cols[k] !== false} onChange=${(e) => setCol(k, e.target.checked)} /></div></th>`;

  return html`<${F}>
    <div className="rjHead">
      <label>שם הרשימה<input className="rjIn" value=${list.name || ""} placeholder="למשל: ריג'קטים חשמל קומה 7"
        autoFocus=${!list.name} onChange=${(e) => edit((l) => ({ ...l, name: e.target.value }))} /></label>
      <label>תאריך<input className="rjIn" type="date" value=${list.list_date || ""} onChange=${(e) => edit((l) => ({ ...l, list_date: e.target.value }))} /></label>
      <label>נוכחים בסיור<input className="rjIn" value=${list.attendees || ""} onChange=${(e) => edit((l) => ({ ...l, attendees: e.target.value }))} /></label>
    </div>
    <${Viewers} subs=${subs} value=${list.viewers || []} onChange=${(v) => edit((l) => ({ ...l, viewers: v }))} />
    <div className="rjBar">
      <button type="button" className="rjBtn primary" onClick=${addRow}><${Plus} size=${15} strokeWidth=${2.4} /> שורה</button>
      <span style=${{ marginInlineEnd: "auto" }}></span>
      <button type="button" className="rjBtn" onClick=${() => onPrint(rowPick)} title=${rowPick ? "הדפסת השורות המסומנות" : "הדפסת כל הרשימה"}>
        <${Printer} size=${15} /> הדפסה${rowPick ? ` (${rowPick.length})` : ""}</button>
      <button type="button" className="rjBtn" onClick=${() => onExcel(rowPick)} title=${rowPick ? "אקסל לשורות המסומנות" : "אקסל לכל הרשימה"}>
        <${FileSpreadsheet} size=${15} /> אקסל${rowPick ? ` (${rowPick.length})` : ""}</button>
    </div>
    <div className="rjWin"><table>
      <thead><tr>
        ${thV("done", "טופל")}
        ${thV("n", "מס\"ד")}
        ${thV("floor", "קומה")}
        ${thV("desc", "תיאור")}
        ${thV("owner", "אחריות")}
        ${thV("due", "מועד לביצוע")}
        ${thV("photos", "תמונות")}
        ${thV("plans", "תוכנית")}
        ${thV("notes", "הערות")}
        <th style=${{ width: 34 }}><input type="checkbox" title="סימון כל השורות להדפסה" checked=${rows.length > 0 && picked.length === rows.length}
          onChange=${(e) => setPick(e.target.checked ? Object.fromEntries(rows.map((r) => [r.id, true])) : {})} /></th>
        <th style=${{ width: 40 }}></th>
      </tr></thead>
      <tbody>
        ${rows.length === 0 && html`<tr><td colSpan="11" className="rjEmpty">אין שורות — "+ שורה"</td></tr>`}
        ${rows.map((r, i) => html`<tr key=${r.id} className=${r.done ? "ok" : ""}>
          <td><input type="checkbox" title="טופל" checked=${!!r.done} onChange=${(e) => setRow(r.id, { done: e.target.checked })} /></td>
          <td style=${{ fontWeight: 800, color: "#5b5e66" }}>${i + 1}</td>
          <td style=${{ width: 80 }}><input className="rjIn" value=${r.floor || ""} onChange=${(e) => setRow(r.id, { floor: e.target.value })} /></td>
          <td><textarea className="rjIn" dir="auto" value=${r.desc || ""} onChange=${(e) => setRow(r.id, { desc: e.target.value })} /></td>
          <td style=${{ width: 130 }}><input className="rjIn" value=${r.owner || ""} onChange=${(e) => setRow(r.id, { owner: e.target.value })} /></td>
          <td style=${{ width: 130 }}><input className="rjIn" type="date" value=${r.due || ""} onChange=${(e) => setRow(r.id, { due: e.target.value })} /></td>
          <td style=${{ minWidth: 150 }}><${Shots} items=${r.photos || []} projectId=${projectId} listId=${list.id} flash=${flash}
            onChange=${(next) => setRow(r.id, { photos: typeof next === "function" ? next(r.photos || []) : next })} rowEdit=${(fn) => edit((l) => { l.rows = (l.rows || []).map((x) => (x.id === r.id ? { ...x, photos: fn(x.photos || []) } : x)); return l; })} /></td>
          <td style=${{ minWidth: 120 }}><${Shots} items=${r.plans || []} projectId=${projectId} listId=${list.id} flash=${flash} noCamera=${true}
            rowEdit=${(fn) => edit((l) => { l.rows = (l.rows || []).map((x) => (x.id === r.id ? { ...x, plans: fn(x.plans || []) } : x)); return l; })} /></td>
          <td style=${{ minWidth: 220 }}><${Notes} notes=${r.notes || []}
            onChange=${(fn) => edit((l) => { l.rows = (l.rows || []).map((x) => (x.id === r.id ? { ...x, notes: fn(x.notes || []) } : x)); return l; })} /></td>
          <td><input type="checkbox" title="להדפסה" checked=${!!pick[r.id]} onChange=${(e) => setPick({ ...pick, [r.id]: e.target.checked })} /></td>
          <td><button type="button" className="rjBtn icon" title="מחיקת השורה" onClick=${() => delRow(r)}><${Trash2} size=${14} color="#b02a37" /></button></td>
        </tr>`)}
      </tbody>
    </table></div>
    <div style=${{ display: "flex", justifyContent: "center", marginTop: 8 }}>
      <button type="button" className="rjBtn" onClick=${addRow}><${Plus} size=${15} strokeWidth=${2.4} /> שורה</button>
    </div>
  <//>`;
}

// ----------------------------------------------------------------------------- who may view this list in the app
// 03.11.26 — a list made for a subcontractor (say the electrician) is shown to
// the users ticked here, view only, in the subcontractor app. Project managers
// see every list anyway, and can edit.
function Viewers({ subs, value, onChange }) {
  const [open, setOpen] = useState(false);
  const people = (subs || []).filter((s) => s && !s.pm && s.active !== false);
  const on = (id) => value.indexOf(id) >= 0;
  const label = (s) => [s.name, s.company].filter(Boolean).join(" · ") || s.phone || "";
  const names = people.filter((s) => on(s.id)).map(label);
  return html`<div className="rjBar" style=${{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
    <div style=${{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="rjBtn" onClick=${() => setOpen((o) => !o)}>הרשאות צפייה ${open ? "▴" : "▾"}</button>
      <span style=${{ fontSize: 12.5, color: "#5b5e66" }}>${names.length ? names.join(", ") : "רק מנהלי פרויקט (באפליקציה) ואת"}</span>
    </div>
    ${open && html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      ${people.length === 0 && html`<span style=${{ fontSize: 12.5, color: "#9a9da5" }}>אין קבלני משנה פעילים בפרויקט — מוסיפים ב"ניהול קבלני משנה"</span>`}
      ${people.map((s) => html`<label key=${s.id} style=${{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, border: "1px solid #e6e6e9", borderRadius: 99, padding: "3px 10px", background: on(s.id) ? "#e3f3e6" : "#fff", cursor: "pointer" }}>
        <input type="checkbox" checked=${on(s.id)} onChange=${(e) => onChange(e.target.checked ? value.concat([s.id]) : value.filter((x) => x !== s.id))} />${label(s)}</label>`)}
    </div>`}
  </div>`;
}

// ----------------------------------------------------------------------------- photos: paste, upload, camera
function Shots({ items, projectId, listId, flash, rowEdit, noCamera }) {
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
    if (p.path) supabase.storage.from(BUCKET).remove([p.path]).catch(() => {});
    rowEdit((cur) => cur.filter((x) => x.id !== p.id));
  };
  return html`<div className="shots" tabIndex="0" onPaste=${onPaste} title="לחיצה כאן ואז Ctrl+V להדבקת תמונה">
    ${items.map((p) => html`<div key=${p.id} className="shot" onClick=${() => openPhoto(p)}>
      <img src=${p.thumb} alt="" /><button type="button" title="הסרה" onClick=${(e) => { e.stopPropagation(); remove(p); }}>×</button></div>`)}
    ${busy > 0 && html`<span style=${{ fontSize: 12, color: "#5b5e66" }}>מעלה…</span>`}
    <div className="shotAdd">
      ${!noCamera && html`<button type="button" className="rjBtn icon" title="צילום" onClick=${() => camRef.current && camRef.current.click()}><${Camera} size=${14} /></button>`}
      <button type="button" className="rjBtn icon" title="העלאת תמונה" onClick=${() => fileRef.current && fileRef.current.click()}><${Upload} size=${14} /></button>
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
      <input className="rjIn" placeholder="הערה חדשה" value=${text} onChange=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      <button type="button" className="rjBtn icon" title="הוספת הערה" disabled=${!text.trim()} onClick=${add}><${Plus} size=${14} strokeWidth=${2.4} /></button>
    </div>
  </div>`;
}

// ----------------------------------------------------------------------------- printing (landscape, house paper)
function rowsFor(l, rowPick) {
  const all = (l.rows || []).map((r, i) => ({ ...r, n: i + 1 }));
  return rowPick ? all.filter((r) => rowPick.indexOf(r.id) >= 0) : all;
}
function secTitle(l) {
  // dates isolated left-to-right, so a Hebrew line does not turn 03/11/2026 round
  return [l.name || "ללא שם", l.list_date ? `תאריך: \u2066${fmt(l.list_date)}\u2069` : "", (l.attendees || "").trim() ? `נוכחים בסיור: ${l.attendees.trim()}` : ""]
    .filter(Boolean).join("  ·  ");
}
export function printLists({ lists, rowPick, projectName, brand, accent, paginateJs, whenPaged }) {
  const b = brand || {};
  const acc = accent || "#14265e";
  // The columns that print are the ones ticked on the FIRST list; with several
  // lists printed together, a column prints if any of them has it ticked.
  const on = {};
  COLS.forEach(([k]) => { on[k] = lists.some((l) => colsOf(l)[k] !== false); });
  const cols = [];
  if (on.n) cols.push(["n", "מס\"ד", 4]);
  if (on.floor) cols.push(["floor", "קומה", 6]);
  if (on.desc) cols.push(["desc", "תיאור", 26]);
  if (on.owner) cols.push(["owner", "אחריות", 10]);
  if (on.due) cols.push(["due", "מועד לביצוע", 8]);
  if (on.photos) cols.push(["photos", "תמונות", 18]);
  if (on.plans) cols.push(["plans", "תוכנית", 12]);
  if (on.notes) cols.push(["notes", "הערות", 18]);
  if (on.done) cols.push(["done", "טופל", 5]);
  const total = cols.reduce((a, c) => a + c[2], 0);
  const colg = cols.map((c) => `<col style="width:${((c[2] / total) * 100).toFixed(2)}%">`).join("");
  const imgs = (arr) => (arr || []).map((p) => `<img class="ph" src="${p.thumb}" alt="">`).join("");
  const cell = (r, k) => {
    if (k === "n") return String(r.n);
    if (k === "due") return r.due ? `<span dir="ltr">${fmt(r.due)}</span>` : "";
    if (k === "photos") return imgs(r.photos);
    if (k === "plans") return imgs(r.plans);
    if (k === "notes") return (r.notes || []).map((n) => `<div class="nt"><b dir="ltr">${fmt(n.at)}</b> ${esc(n.text)}</div>`).join("");
    if (k === "done") return r.done ? "✓" : "";
    return esc(r[k]).replace(/\n/g, "<br>");
  };
  const body = lists.map((l) => rowsFor(l, rowPick).map((r) =>
    `<tr data-sec="${esc(secTitle(l))}"${r.done ? ' class="ok"' : ""}>${cols.map((c) => `<td class="c-${c[0]}">${cell(r, c[0])}</td>`).join("")}</tr>`).join("")).join("");
  const logo = b.logoUrl ? `<img src="${b.logoUrl}" alt="logo">` : "<span></span>";
  const clientLogo = b.clientLogoUrl ? `<img class="clientLogo" src="${b.clientLogoUrl}" alt="logo">` : "<span></span>";
  const footBlock = b.footerImg ? `<div class="footImg" id="footimg"><img src="${b.footerImg}" alt="footer"></div>` : "";
  const title = lists.length === 1 ? (lists[0].name || "ריג'קטים") : "ריג'קטים";
  const doc = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(`${projectName || ""} - ${title}`)}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Inter:wght@500;600;700&display=swap');
${printSheetCss({ landscape: true, accent: acc, marginMm: 7, framePad: "3mm 5mm" })}
body { font-family: 'Assistant', 'Inter', Arial, sans-serif; color: #17181c; direction: rtl; }
.hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; border-bottom: 2.5px solid #d5d9df; padding-bottom: 8px; margin-bottom: 8px; }
.hdr img { max-height: 40px; max-width: 140px; object-fit: contain; justify-self: start; }
.hdr img.clientLogo { justify-self: end; }
.ttlWrap { grid-column: 2; text-align: center; }
.ttlWrap .ttl { font-size: 18px; font-weight: 800; color: ${acc}; }
.ttlWrap .sub { font-size: 11px; font-weight: 600; color: ${acc}; margin-top: 2px; }
.pgSec { font-size: 11px; font-weight: 800; color: #fff; background: ${acc}; padding: 5px 8px; border-radius: 6px; margin: 0 0 5px; text-align: center; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th { background: ${acc}; color: #fff; font-size: 9.5px; font-weight: 800; padding: 5px 4px; }
td { font-size: 9px; padding: 4px; border-bottom: 1px solid #e6e8ec; text-align: center; vertical-align: top; word-break: break-word; }
td.c-desc, td.c-notes { text-align: right; }
tr.ok td { background: #e3f3e6; }
img.ph { width: 70px; height: 52px; object-fit: cover; border-radius: 3px; margin: 1px; border: 1px solid #e6e8ec; }
.nt { margin-bottom: 2px; } .nt b { color: #5b5e66; direction: ltr; unicode-bidi: isolate; }
</style></head><body><div id="src">
<div class="hdr">${logo}<div class="ttlWrap"><div class="ttl">${esc(projectName || "")}</div><div class="sub">${esc(title)}</div></div>${clientLogo}</div>
<table><colgroup>${colg}</colgroup><thead><tr>${cols.map((c) => `<th>${esc(c[1])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
${footBlock}</div><div id="pages"></div>${paginateJs ? paginateJs(printedStampText("he")) : ""}</body></html>`;
  if (printLists.docOnly) return doc;
  const w = window.open("", "_blank");
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
