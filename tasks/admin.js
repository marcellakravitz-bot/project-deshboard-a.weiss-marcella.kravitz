// =============================================================================
//  tasks/admin.js — ניהול משימות (task management). A. Weiss dashboard
//  tasks build 2 · 14.11.2026 (site: build 309) — task-notify carries the task
//
//  The dashboard loads this file when the administrator opens the cube.
//
//  Her layout (06.11.26):
//    a "+" for a new task; the tasks grouped by category, each category a
//    heading that opens and closes (as in the contacts); above them the
//    category bar the other boards have — only the categories in use.
//    The categories themselves are kept in the categories library
//    ("מאגרי מידע" > קטגוריות), as catalog.taskCats.
//    Columns: תאריך הקמה · תיאור · אחריות · תאריך יעד · סטטוס ·
//             הערות / מידע נוסף · עדכונים
//    עדכונים: a small "+" opens a little window — today's date, filled in by
//    itself, and a box for the update; beside it, on the left, "רשימת
//    עדכונים" opens the updates saved so far.
//
//  Storage: one row per project in public.project_tasks (see
//  supabase/001_tasks.sql), administrator only. Never app_state.
//  Saving follows the rule learned 14.10.26: only what was edited, only for
//  the project that was loaded, and a run that has been overtaken stops.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";
import { Plus, X, Save, FileText, FileSpreadsheet, ChevronDown, ChevronUp, ChevronLeft, Trash2, History, GripVertical } from "lucide-react";
import { supabase, PrintLangAsk } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;
export const TASKS_BUILD = "tasks build 11 · 06.11.2026";
if (typeof console !== "undefined") console.info(TASKS_BUILD);

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// The local date, not UTC: at half past midnight in Israel UTC is still yesterday.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const NONE = "__none__";

// 06.11.26 — the fixed categories, on every project, each with the tasks that
// are always there (her lists). Fixed tasks cannot be deleted and their
// wording is fixed; everything else on them (dates, owner, status, notes,
// updates) is hers, and any category takes more tasks of her own.
// The ids are permanent: a project's marks hang on them.
const KO = "תיאום פגישת התנעה ";
export const FIXED_CATS = [
  { key: "tc-site-open", he: "תיק פתיחת אתר", tasks: [
    ["fx-start-order", "צו תחילת עבודה (פיקוח)"],
    ["fx-site-manager", "מינוי מנהל עבודה רשום"],
    ["fx-risk-survey", "סקר סיכונים"],
    ["fx-site-rules", "נהלי בניין"],
    ["fx-rejects-floors", "דוח ריג'קטים טרם קבלת הקומות"],
    ["fx-floor-handover", "תיאום סיור מסירת קומות"],
  ] },
  { key: "tc-kickoff", he: "פגישות התנעת פרויקט", tasks: [
    ["fx-ko-arch", KO + "הצגת פרויקט אדריכלים - פרונטלי"],
    ["fx-ko-main", KO + "קבלן ראשי + פיקוח - פרונטלי"],
    ["fx-ko-mep", KO + "יועצי מערכות MEP - זום"],
    ["fx-ko-elec", KO + "קבלן חשמל"],
    ["fx-ko-hvac", KO + "קבלן מיזוג אוויר"],
    ["fx-ko-plumb", KO + "קבלן אינסטלציה"],
    ["fx-ko-gypsum", KO + "קבלן גבס"],
    ["fx-ko-paint", KO + "קבלן צבע"],
    ["fx-ko-sec", KO + "קבלן ביטחון ותקשורת"],
    ["fx-ko-media", KO + "קבלן מולטימדיה"],
  ] },
  { key: "tc-site-setup", he: "התארגנות אתר", tasks: [
    ["fx-su-ac", "התקנת יחידת מיזוג אוויר עבור משרד אתר במידה ונדרש"],
    ["fx-su-power", "ביצוע עמדות חשמל זמני"],
    ["fx-su-power-check", "בודק חשמל עבור עמדות חשמל זמני"],
    ["fx-su-light", "ביצוע תאורה זמנית"],
    ["fx-su-safety-signs", "הזמנת שילוט בטיחות - סט מרלו\"ג"],
    ["fx-su-floor-signs", "הכנת שילוט התארגנות אתר לפי קומות"],
    ["fx-su-plan-print", "הדפסת תוכנית התארגנות אתר"],
    ["fx-su-office-signs", "הכנת שילוט משרדים זמניים"],
    ["fx-su-office-print", "הדפסת שילוט משרדים זמניים"],
    ["fx-su-nosmoke", "הזמנת שילוט אסור לעשן"],
    ["fx-su-waste", "הזמנת שילוט ריכוז פסולת"],
    ["fx-su-emerg-signs", "הכנת שילוט התארגנות במצב חירום"],
    ["fx-su-emerg-print", "הדפסת שילוט התארגנות במצב חירום"],
  ] },
  { key: "tc-change-orders", he: "הוראות שינוי", tasks: [] },
  { key: "tc-hvac", he: "מיזוג אוויר", tasks: [
    ["fx-hv-plans", "קבלת סט תוכניות לביצוע"],
    ["fx-hv-subm", "אישור סבמיטלים עבור כלל הציוד"],
    ["fx-hv-samples", "אספקת דוגמאות לשטח לאישור אדריכלי"],
  ] },
  { key: "tc-elec", he: "חשמל", tasks: [
    ["fx-el-plans", "קבלת סט תוכניות לביצוע"],
    ["fx-el-subm", "אישור סבמיטלים עבור כלל הציוד"],
    ["fx-el-samples", "אספקת דוגמאות לשטח לאישור אדריכלי (כולל גילוי אש)"],
    ["fx-el-radiation", "סקר מיגון קרינה במידה ונדרש"],
    ["fx-el-dwg", "דרישה תוכניות PDF + DWG מיועץ חשמל עבור תכנון לוחות חשמל (כולל לוח חשמל חדר תקשורת)"],
    ["fx-el-sd-panels", "העברת בקשה לביצוע SD - לוחות חשמל - לאישור יועץ חשמל"],
  ] },
  { key: "tc-approvals", he: "אישורים מהבניין / מהפיקוח", tasks: [
    ["fx-ap-plans", "אישור מהפיקוח עבור סט תוכניות בטיחות, מיזוג אוויר, אדריכלות, חשמל ואינסטלציה"],
    ["fx-ap-feed", "להעביר לבניין גודל הזנת לוח חשמל דיירים כנדרש - מתוך תכנון לוחות חשמל"],
    ["fx-ap-carpentry", "קבלת רשימת נגרות"],
    ["fx-ap-lights", "קבלת רשימת גופי תאורה"],
    ["fx-ap-elec-products", "קבלת רשימת מוצרי חשמל"],
  ] },
  { key: "tc-purchase", he: "הזמנות רכש", tasks: [
    ["fx-po-frame", "הזמנת מסגרת"],
    ["fx-po-suppliers", "הוצאת הזמנות לכלל הספקים (לפי דוח LLI)"],
  ] },
  // 06.11.26 — categories she listed with no fixed tasks yet.
  { key: "tc-structural", he: "קונסטרוקטור", tasks: [] },
  { key: "tc-mnm", he: "מנ\"מ", tasks: [] },
  { key: "tc-comms-room", he: "חדר תקשורת", tasks: [] },
  { key: "tc-plumbing", he: "אינסטלציה", tasks: [] },
  { key: "tc-doors", he: "דלתות", tasks: [] },
  { key: "tc-lighting", he: "תאורה", tasks: [] },
  { key: "tc-skilled", he: "עובד מקצועי", tasks: [] },
  { key: "tc-finish-guides", he: "הנחיות גמרים", tasks: [] },
  { key: "tc-fire-safety", he: "בטיחות אש - יועץ בטיחות", tasks: [
    ["fx-fs-submit", "הגשת תוכניות בטיחות לכבאות"],
    ["fx-fs-ops", "קבלת משטר הפעלות"],
  ] },
  { key: "tc-admin", he: "מנהלות", tasks: [] },
];
const FIXED_CAT_KEYS = new Set(FIXED_CATS.map((c) => c.key));
const FIXED_DEFS = [];
FIXED_CATS.forEach((c) => c.tasks.forEach(([id, desc]) => FIXED_DEFS.push({ id, desc, category: c.key })));
// 06.11.26 — the fixed tasks live in the library ("מאגרי מידע" > משימות
// קבועות) as catalog.taskFixed [{ id, category, desc }]: she adds, rewords,
// moves to another category and deletes them there, for every project. The
// lists above go in once each (taskSeeded / taskFixedSeeded remember which),
// so one she deleted does not come back.
export function taskSeedPatch(catalog) {
  const c = catalog || {};
  const list = c.taskCats || [];
  const seeded = new Set(c.taskSeeded || []);
  const freshCats = FIXED_CATS.filter((f) => !seeded.has(f.key));
  const fixed = Array.isArray(c.taskFixed) ? c.taskFixed : [];
  const fSeeded = new Set(Array.isArray(c.taskFixedSeeded) ? c.taskFixedSeeded : []);
  const freshFixed = FIXED_DEFS.filter((d) => !fSeeded.has(d.id));
  if (!freshCats.length && !freshFixed.length) return null;
  return {
    taskCats: list.concat(freshCats.filter((f) => !list.some((x) => x && x.key === f.key)).map((f) => ({ key: f.key, he: f.he }))),
    taskSeeded: Array.from(seeded).concat(freshCats.map((f) => f.key)),
    taskFixed: fixed.concat(freshFixed.filter((d) => !fixed.some((x) => x.id === d.id)).map((d) => ({ id: d.id, category: d.category, desc: d.desc }))),
    taskFixedSeeded: Array.from(fSeeded).concat(freshFixed.map((d) => d.id)),
  };
}

// 06.11.26 — the project managers' app writes to the same board (sub-portal,
// "task-save"), so the board is never simply overwritten: every field changed
// carries its time (fts), and a save merges the stored board with this one
// field by field — the later change wins, updates from both sides are kept,
// and a task or an update deleted here (gone / updGone) stays deleted.
const stampOf = (p) => { const now = Date.now(); const f = {}; Object.keys(p || {}).forEach((k) => { f[k] = now; }); return f; };
function mergeTask(a, b) {
  const fa = a.fts || {}, fb = b.fts || {};
  const out = { ...a };
  new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => {
    if (k === "fts" || k === "updates" || k === "updGone") return;
    if (!(k in b)) return;
    if (!(k in a) || (fb[k] || 0) >= (fa[k] || 0)) out[k] = b[k];
  });
  const gone = Array.from(new Set((a.updGone || []).concat(b.updGone || [])));
  const seen = new Set();
  const ups = [];
  (a.updates || []).concat(b.updates || []).forEach((u) => {
    if (!u || !u.id || seen.has(u.id) || gone.includes(u.id)) return;
    seen.add(u.id); ups.push(u);
  });
  out.updates = ups;
  if (gone.length) out.updGone = gone;
  const fts = { ...fa };
  Object.keys(fb).forEach((k) => { fts[k] = Math.max(fts[k] || 0, fb[k] || 0); });
  if (Object.keys(fts).length) out.fts = fts;
  return out;
}
export function mergeTaskDocs(remote, local) {
  const r = remote || {}, l = local || {};
  const gone = Array.from(new Set((r.gone || []).concat(l.gone || [])));
  const rt = Array.isArray(r.tasks) ? r.tasks : [], lt = Array.isArray(l.tasks) ? l.tasks : [];
  const byL = {};
  lt.forEach((t) => { if (t && t.id) byL[t.id] = t; });
  const used = new Set();
  const tasks = [];
  rt.forEach((t) => {
    if (!t || !t.id || gone.includes(t.id)) return;
    used.add(t.id);
    tasks.push(byL[t.id] ? mergeTask(t, byL[t.id]) : t);
  });
  lt.forEach((t) => { if (t && t.id && !used.has(t.id) && !gone.includes(t.id)) tasks.push(t); });
  return { ...r, ...l, tasks, gone };
}

// 06.11.26 — a traffic light: a new task starts "טרם בוצע" in red, "בטיפול"
// is orange, "בוצע" green; "לידיעה בלבד" is grey.
export const TASK_STATUS = [
  ["open", "טרם בוצע", "#fff", "#d93a3a"],
  ["progress", "בטיפול", "#3d2a00", "#f5a524"],
  ["done", "בוצע", "#fff", "#2f9e57"],
  ["info", "לידיעה בלבד", "#fff", "#8a8d94"],
];
const ST = Object.fromEntries(TASK_STATUS.map((s) => [s[0], s]));

const css = `
.tsk{font-family:'Assistant','Inter',sans-serif;color:var(--ink,#17181c);font-size:14px;width:100%;box-sizing:border-box;max-width:1440px;margin:0 auto;padding:0 16px 28px}
.tsk .tskBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:8px 12px;margin-bottom:10px}
/* 06.11.26 — every category in the bar, small and plain, wrapping onto a
   second line when needed and always centred; the tools on their own line, left. */
.tsk .tskBar .sbCatBar{margin:0;flex:1 1 100%;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 6px}
.tsk .tskBar .sbCatBar .sbCatBtn{font-size:11.5px;font-weight:400;padding:4px 10px}
/* 06.11.26 — the categories fill the bar from edge to edge, shared evenly
   between the lines: 11 of them are 6 above and 5 below. */
.tsk .tskBar .sbCatBar.even{gap:5px;max-width:none;width:100%;box-sizing:border-box}
.tsk .tskBar .sbCatBar.even .sbCatBtn{flex:0 0 calc((100% - (var(--per) - 1) * 5px) / var(--per));box-sizing:border-box;margin:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsk .tskBar .sbCatBar .sbCatBtn.on{font-weight:600}
.tsk .tskTools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-inline-start:auto}
.tsk .tskBtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:9px;border:1px solid var(--line,#e6e6e9);background:#fff;color:var(--ink,#17181c);cursor:pointer;white-space:nowrap}
.tsk .tskBtn:hover{border-color:var(--accent,#17181c)}
.tsk .tskBtn.primary{background:var(--accent,#14265e);border-color:var(--accent,#14265e);color:#fff}
.tsk .tskBtn.icon{padding:5px 7px}
.tsk .tskBtn:disabled{opacity:.45;cursor:default}
.tsk .tskWin{background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:12px}
.tsk .tskGrp{margin-bottom:12px}
.tsk .tskHead{width:100%;box-sizing:border-box;gap:6px}
.tsk .tskHead{position:relative;cursor:grab}
.tsk .tskHead.dragging{opacity:.45}
.tsk .tskHead.dropBefore::before,.tsk .tskHead.dropAfter::after{content:"";position:absolute;left:0;right:0;height:3px;border-radius:3px;background:var(--accent,#14265e)}
.tsk .tskHead.dropBefore::before{top:-7px}
.tsk .tskHead.dropAfter::after{bottom:-7px}
.tsk .tskHeadBtn{flex:1 1 auto;display:flex;align-items:center;gap:8px;border:0;background:none;cursor:pointer;font:inherit;font-weight:800;color:inherit;text-align:start;padding:0}
.tsk .tskAddIn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line,#e6e6e9);background:#fff;border-radius:7px;cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:2px 8px;color:#3f434b}
.tsk .tskAddIn:hover{border-color:var(--accent,#14265e)}
.tsk .tskCatDel{border:0;background:none;cursor:pointer;color:#b02a37;display:flex;padding:3px;border-radius:6px;opacity:.55}
.tsk .tskCatDel:hover{opacity:1;background:#fff}
.tsk .tskGrip{cursor:grab;color:#8a8d94;display:flex}
.tsk .tskMove{display:flex;gap:2px}
.tsk .tskMove button{border:1px solid var(--line,#e6e6e9);background:#fff;border-radius:6px;cursor:pointer;display:flex;padding:2px 4px;color:#3f434b}
.tsk .tskMove button:disabled{opacity:.35;cursor:default}
.tsk .tskGrp .contactsSecChev{color:var(--steel,#5b5e66)}
.tsk table{border-collapse:collapse;width:100%;table-layout:fixed;background:#fff}
.tsk th{background:var(--accent,#14265e);color:#fff;font-size:11.5px;font-weight:800;padding:7px 5px;text-align:center;line-height:1.2}
.tsk td{font-size:13px;padding:5px 4px;border-bottom:1px solid #eceef1;text-align:center;vertical-align:middle}
.tsk tr.done td{background:#e3f3e6}
.tsk tr.info td{background:#f4f4f6;color:#6b6e75}
.tsk tr.late td.due input{color:#b02a37;font-weight:800}
.tsk .tskIn{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--line,#e6e6e9);border-radius:7px;padding:5px 7px;font:inherit;font-size:13px;background:#fff}
.tsk textarea.tskIn{resize:vertical;min-height:32px;line-height:1.4}
.tsk textarea.tskArea{display:block}
.tsk input[type=date].tskIn{padding:5px 4px;font-size:12.5px}
.tsk tr.done .tskIn{background:transparent}
.tsk select.tskSt{font-weight:800;border-radius:99px;text-align:center;padding:4px 6px;border:0}
.tsk select.tskSt option{background:#fff;color:#17181c}
.tsk .tskUpd{display:flex;align-items:center;justify-content:center;gap:4px}
.tsk .tskUpd .last{font-size:11px;color:#5b5e66;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tsk .tskFixed{text-align:start;font-weight:400;padding:5px 7px;font-size:13px;line-height:1.4}
.tsk .tskEnd{display:flex;flex-direction:column;align-items:center;gap:3px}
.tsk .tskRfi{border:1px solid #7C3AED;color:#7C3AED;background:#fff;border-radius:6px;font:inherit;font-size:10.5px;font-weight:800;padding:1px 6px;cursor:pointer;white-space:nowrap}
.tsk .tskRfi:hover{background:#f3edff}
.tsk .tskRfi.on{background:#7C3AED;color:#fff}
.tsk .tskBy{font-size:11px;color:#9aa0a8;margin-top:3px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsk .tskEmpty{padding:22px;text-align:center;color:var(--mist,#9a9da5)}
.tsk .tskErr{color:#b02a37;font-weight:600;font-size:13px;text-align:center;margin:10px 0}
.tsk .tskSave{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:14px}
.tsk .tskSaved{font-size:12.5px;color:#1f7a3e;font-weight:700}
.tsk .tskScrim{position:fixed;inset:0;background:rgba(16,17,20,.32);z-index:880;display:flex;align-items:center;justify-content:center;padding:16px}
.tsk .tskPop{background:#fff;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.22);width:min(460px,100%);max-height:86vh;overflow:auto;padding:14px 16px;position:relative}
.tsk .tskPop h3{margin:0 0 4px;text-align:center;font-size:16px;font-weight:800}
.tsk .tskPop .sub{text-align:center;font-size:12.5px;color:#5b5e66;margin-bottom:10px}
.tsk .tskPop .x{position:absolute;top:10px;inset-inline-end:10px;border:0;background:none;cursor:pointer;color:#8a8d94;display:flex}
.tsk .tskPop label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:800;color:#5b5e66;margin-bottom:10px}
.tsk .tskPop .row{display:flex;gap:8px;justify-content:center;margin-top:6px}
.tsk .tskLog{display:flex;flex-direction:column;gap:8px}
.tsk .tskLog .it{border:1px solid #eceef1;border-radius:10px;padding:8px 10px;background:#fafbfc}
.tsk .tskLog .d{font-size:11.5px;font-weight:800;color:var(--accent,#14265e);display:flex;align-items:center;gap:6px}
.tsk .tskLog .d button{margin-inline-start:auto;border:0;background:none;cursor:pointer;color:#b02a37;display:flex;padding:0}
.tsk .tskLog .t{white-space:pre-wrap;font-size:13px;margin-top:3px;line-height:1.5}
.tsk .tskToast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#101114;color:#fff;padding:9px 16px;border-radius:10px;font-weight:600;font-size:13px;z-index:900}
@media (max-width:760px){.tsk .tskTblWrap{overflow-x:auto}.tsk table{min-width:860px}}
`;

export function TasksBoard({ projectId, projectName, currentEmail, catalog, onCatalogChange, contacts, onCreateRfi, boardExport }) {
  const [exportAsk, setExportAsk] = useState(null);   // "pdf" | "xlsx"
  const [data, setData] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const [err, setErr] = useState("");
  const [saveState, setSaveState] = useState("");
  const [toast, setToast] = useState("");
  const [cat, setCat] = useState("all");
  const [openGrp, setOpenGrp] = useState({});        // category key -> open
  const [newAsk, setNewAsk] = useState(false);
  const [updFor, setUpdFor] = useState(null);         // task id: the "+" window
  const [logFor, setLogFor] = useState(null);         // task id: the list of updates
  const dirtyRef = useRef(false);
  const runRef = useRef(0);
  const timerRef = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;
  const flash = (t) => { setToast(t); setTimeout(() => setToast(""), 1800); };

  // ---------------------------------------------------------------- load
  useEffect(() => {
    let off = false;
    setData(null); setLoadedFor(null); setErr(""); dirtyRef.current = false;
    (async () => {
      const { data: row, error } = await supabase.from("project_tasks").select("data").eq("project_id", projectId).maybeSingle();
      if (off) return;
      if (error) {
        console.warn("[tasks] load failed", error);
        setErr(/relation|does not exist|schema cache/i.test(error.message || "")
          ? "טבלת המשימות עדיין לא קיימת ב-Supabase — יש להריץ את tasks/supabase/001_tasks.sql"
          : "טעינת המשימות נכשלה: " + (error.message || ""));
        return;
      }
      const d = { tasks: [], ...((row && row.data) || {}) };
      if (!Array.isArray(d.tasks)) d.tasks = [];
      console.info("[tasks] loaded", projectId, d.tasks.length);
      setData(d); setLoadedFor(projectId);
    })();
    return () => { off = true; };
  }, [projectId]);

  // 06.11.26 — live: what the project managers write in the app shows here
  // within seconds, as long as nothing typed here is waiting to be saved.
  useEffect(() => {
    if (loadedFor !== projectId) return;
    let off = false;
    const pull = async () => {
      if (off || dirtyRef.current || document.visibilityState !== "visible") return;
      const { data: row, error } = await supabase.from("project_tasks").select("data").eq("project_id", projectId).maybeSingle();
      if (off || error || dirtyRef.current || !row || !row.data) return;
      const d = { tasks: [], ...row.data };
      if (!Array.isArray(d.tasks)) d.tasks = [];
      if (JSON.stringify(d) === JSON.stringify(dataRef.current)) return;
      dataRef.current = d; setData(d);
    };
    const t = setInterval(pull, 15000);
    window.addEventListener("focus", pull);
    return () => { off = true; clearInterval(t); window.removeEventListener("focus", pull); };
  }, [loadedFor, projectId]);

  // ---------------------------------------------------------------- save
  const saveNow = async () => {
    clearTimeout(timerRef.current);
    if (!dirtyRef.current || loadedFor !== projectId || !dataRef.current) return;
    const run = ++runRef.current;
    const payload = dataRef.current;
    dirtyRef.current = false;
    setSaveState("saving");
    let error = null, merged = null;
    for (let attempt = 0; attempt < 4 && !merged && !error; attempt++) {
      const { data: row, error: rerr } = await supabase.from("project_tasks").select("data, updated_at").eq("project_id", projectId).maybeSingle();
      if (rerr) { error = rerr; break; }
      const next = row ? mergeTaskDocs(row.data || {}, payload) : payload;
      const stamp = { data: next, updated_at: new Date().toISOString(), updated_by: currentEmail || null };
      const res = row
        ? await supabase.from("project_tasks").update(stamp).eq("project_id", projectId).eq("updated_at", row.updated_at).select("project_id")
        : await supabase.from("project_tasks").insert({ project_id: projectId, ...stamp }).select("project_id");
      if (res.error) { if (!row && /duplicate/i.test(res.error.message || "")) continue; error = res.error; break; }
      if (res.data && res.data.length) merged = next;
    }
    if (run !== runRef.current) return;
    if (error || !merged) {
      console.warn("[tasks] save failed", error);
      dirtyRef.current = true;
      setSaveState(""); setErr("השמירה נכשלה: " + ((error && error.message) || "נסו שוב"));
      return;
    }
    // What the app wrote meanwhile is now on screen too.
    if (!dirtyRef.current) { dataRef.current = merged; setData(merged); }
    setErr(""); setSaveState("saved");
    setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 2200);
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  useEffect(() => () => { if (dirtyRef.current) saveRef.current(); }, []);
  const edit = (fn) => {
    setData((cur) => {
      if (!cur) return cur;
      const next = fn(structuredClone(cur));
      dirtyRef.current = true;
      dataRef.current = next;
      return next;
    });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveRef.current(), 900);
  };

  // ---------------------------------------------------------------- categories
  // 06.11.26 — her categories go into the library once ("taskSeeded" says
  // which); after that the library is hers: she adds, deletes and reorders,
  // and a category she deleted does not come back.
  useEffect(() => {
    if (!onCatalogChange || !catalog) return;
    const p = taskSeedPatch(catalog);
    if (p) onCatalogChange({ ...catalog, ...p });
  }, [catalog && (catalog.taskSeeded || []).length, catalog && (catalog.taskFixedSeeded || []).length]);
  const cats = ((catalog || {}).taskCats || []).filter((c) => c && c.key && String(c.he || "").trim());
  const catName = (k) => (k === NONE ? "ללא קטגוריה" : ((cats.find((c) => c.key === k) || {}).he || "ללא קטגוריה"));
  // The fixed tasks, from the library (or the built-in lists until it is filled).
  const defs = (Array.isArray((catalog || {}).taskFixed) ? catalog.taskFixed : FIXED_DEFS).filter((d) => d && d.id && String(d.desc || "").trim());
  const defIds = new Set(defs.map((d) => d.id));
  const isFixed = (t) => defIds.has(t.id);
  // What the board shows: every fixed task of the library — the project's own
  // record of it, or a fresh one not yet written — with the library's wording
  // and category, in the library's order; then her own tasks. A fixed task
  // deleted from the library, or whose category was deleted, is gone.
  const goneIds = new Set((data && data.gone) || []);
  const own = ((data && data.tasks) || []).filter((t) => t && !goneIds.has(t.id));
  const byId = {};
  own.forEach((t) => { byId[t.id] = t; });
  const nowDay = today();
  const tasks = defs.filter((d) => cats.some((c) => c.key === d.category)).map((d) => ({
    ...(byId[d.id] || { id: d.id, created: nowDay, owner: "", due: "", status: "open", notes: "", updates: [] }),
    fixed: true, desc: d.desc, category: d.category,
  })).concat(own.filter((t) => !defIds.has(t.id) && !t.fixed));
  const catOf = (t) => (t.category && cats.some((c) => c.key === t.category) ? t.category : NONE);
  // Every category of the library is a group (closed until opened), so each
  // has its "+ משימה"; the bar above carries only the ones with tasks.
  const withTasks = cats.filter((c) => tasks.some((t) => catOf(t) === c.key)).map((c) => c.key)
    .concat(tasks.some((t) => catOf(t) === NONE) ? [NONE] : []);
  const inUse = cats.map((c) => c.key).concat(tasks.some((t) => catOf(t) === NONE) ? [NONE] : []);
  const shownGroups = cat === "all" ? inUse : inUse.filter((k) => k === cat);
  const allOpen = inUse.length > 0 && inUse.every((k) => !!openGrp[k]);
  // Even lines in the category bar: one line up to 7, else as few as fit.
  const barN = inUse.length + 1;
  const perRow = barN <= 7 ? barN : Math.ceil(barN / Math.ceil(barN / 7));
  useEffect(() => { if (cat !== "all" && !inUse.includes(cat)) setCat("all"); }, [inUse.join("|")]);
  const [newCat, setNewCat] = useState(null);         // the "+ קטגוריה" box
  const deleteCat = (k) => {
    if (!onCatalogChange || k === NONE) return;
    const n = tasks.filter((t) => catOf(t) === k);
    const fixedN = n.filter((t) => isFixed(t)).length;
    const own = n.length - fixedN;
    if (!confirm(`למחוק את הקטגוריה "${catName(k)}" מהמערכת (מכל הפרויקטים)?`
      + (fixedN ? `\nהמשימות הקבועות שלה יורדו.` : "")
      + (own ? `\n${own} משימות שהוספת בפרויקט הזה יעברו ל"ללא קטגוריה".` : ""))) return;
    onCatalogChange({ ...(catalog || {}), taskCats: ((catalog || {}).taskCats || []).filter((c) => c.key !== k) });
  };

  const people = useMemo(() => {
    const out = new Set();
    (contacts || []).forEach((c) => { const n = (c.person && (c.person.he || c.person.en)) || ""; if (n.trim()) out.add(n.trim()); });
    tasks.forEach((t) => { if (String(t.owner || "").trim()) out.add(t.owner.trim()); });
    return Array.from(out).sort();
  }, [contacts, tasks]);

  const patch = (id, p) => edit((d) => {
    const fts = stampOf(p);
    if (d.tasks.some((t) => t.id === id)) d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, ...p, fts: { ...(t.fts || {}), ...fts } } : t));
    else { const v = tasks.find((t) => t.id === id); if (v) d.tasks = [...d.tasks, { ...v, ...p, fts }]; }
    return d;
  });
  const remove = (t) => {
    if (isFixed(t)) return;
    if (!confirm(`למחוק את המשימה "${String(t.desc || "").slice(0, 60) || "ללא תיאור"}"?`)) return;
    edit((d) => { d.tasks = d.tasks.filter((x) => x.id !== t.id); d.gone = Array.from(new Set((d.gone || []).concat([t.id]))); return d; });
  };
  // 06.11.26 — the small "RFI" button: a row opens on the RFI board, addressed
  // to the supervision / client, with the task's text; the task keeps its number.
  const toRfi = (t) => {
    if (!onCreateRfi) return;
    if (t.rfi && !confirm(`כבר נפתח RFI ${t.rfi.no} מהמשימה הזו. לפתוח RFI נוסף?`)) return;
    if (!t.rfi && !confirm(`לפתוח שורת RFI ללקוח / פיקוח מהמשימה\n"${String(t.desc || "").slice(0, 80)}"?`)) return;
    const res = onCreateRfi(t);
    if (!res) return;
    patch(t.id, { rfi: { id: res.id, no: res.no }, updates: [...(t.updates || []), { id: uid("u"), date: today(), text: `נפתח RFI ${res.no}`, by: currentEmail || "" }] });
    flash(`נפתח RFI ${res.no} — בלחצן RFI`);
  };
  // 06.11.26 — who did it: the name the signed-in user has among the
  // contacts (by e-mail), or the e-mail itself. Kept on the task so the
  // project managers' app shows the same.
  const me = useMemo(() => {
    const em = String(currentEmail || "").trim().toLowerCase();
    if (!em) return null;
    const pool = (contacts || []).concat((catalog || {}).people || []);
    const hit = pool.find((c) => String(c.email || "").trim().toLowerCase() === em);
    const nm = hit && hit.person && (hit.person.he || hit.person.en);
    return { email: em, name: String(nm || "").trim() || em.split("@")[0] };
  }, [currentEmail, contacts, catalog]);
  const create = (category, desc) => {
    const t = { id: uid("t"), category: category || "", created: today(), createdBy: me, desc: desc || "", owner: "", due: "", status: "open", notes: "", updates: [] };
    t.fts = stampOf(t);
    edit((d) => { d.tasks = [...d.tasks, t]; return d; });
    setOpenGrp((o) => ({ ...o, [category || NONE]: true }));
    // 06.11.26 — the project managers are told on their phones, once it is saved.
    setTimeout(async () => {
      try {
        const { data: ses } = await supabase.auth.getSession();
        const tok = ses && ses.session && ses.session.access_token;
        if (!tok) return;
        await fetch("https://jvssavyfjuhjniqkiymo.supabase.co/functions/v1/sub-portal", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "task-notify", accessToken: tok, projectId, taskId: t.id, desc: t.desc || "" }) });
      } catch (e) { console.warn("[tasks] notify failed", e); }
    }, 2500);
    setNewAsk(false);
    flash("המשימה נוספה");
  };
  // 06.11.26 — the groups move up and down among themselves (closed or open):
  // she decides which comes first. The order is the library's, so every
  // project shows them the same way.
  // 06.11.26 — no arrows: a category is dragged by its heading; a line shows
  // where it will land, and the page scrolls while it is held near the top or
  // the bottom, so it can go anywhere on the board, not only what is on screen.
  const [dragK, setDragK] = useState(null);
  const [dropAt, setDropAt] = useState(null);         // { k, pos: "before" | "after" }
  const moveCat = (k, toK, pos) => {
    if (!onCatalogChange || k === NONE || toK === NONE || k === toK) return;
    const all = ((catalog || {}).taskCats || []).slice();
    const from = all.findIndex((c) => c.key === k);
    if (from < 0) return;
    const [x] = all.splice(from, 1);
    const to = all.findIndex((c) => c.key === toK);
    if (to < 0) return;
    all.splice(pos === "after" ? to + 1 : to, 0, x);
    onCatalogChange({ ...(catalog || {}), taskCats: all });
  };
  useEffect(() => {
    if (!dragK) return;
    let raf = 0, dy = 0;
    const tick = () => { if (dy) { window.scrollBy(0, dy); raf = requestAnimationFrame(tick); } else raf = 0; };
    const onOver = (e) => {
      const edge = 80, h = window.innerHeight;
      dy = e.clientY < edge ? -Math.ceil((edge - e.clientY) / 4) : e.clientY > h - edge ? Math.ceil((e.clientY - (h - edge)) / 4) : 0;
      if (dy && !raf) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("dragover", onOver);
    return () => { document.removeEventListener("dragover", onOver); if (raf) cancelAnimationFrame(raf); dy = 0; };
  }, [dragK]);
  const addCat = (name) => {
    const v = String(name || "").trim();
    if (!v || !onCatalogChange) return "";
    const hit = cats.find((c) => c.he.trim() === v);
    if (hit) return hit.key;
    const key = `tc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    onCatalogChange({ ...(catalog || {}), taskCats: [...((catalog || {}).taskCats || []), { key, he: v }] });
    return key;
  };

  // ------------------------------------------------ PDF / Excel (06.11.26)
  // The groups on the screen (all, or the category picked in the bar), each
  // under its heading, in the boards' print design; the status colours the
  // row as on the screen (red / orange / green).
  const REPORT = "ניהול משימות";
  const tskTitles = () => ({
    title: (projectName || "").trim() || REPORT,
    subtitle: cat === "all" ? REPORT : `${REPORT} – ${catName(cat)}`,
    date: `תאריך הנפקת דוח ${fmt(today())}`
  });
  const doExport = async (kind, hdr) => {
    if (!boardExport) return;
    const H = hdr || tskTitles();
    const head = ["תאריך הקמה", "תיאור", "אחריות", "תאריך יעד", "סטטוס", "תאריך ביצוע", "הערות / מידע נוסף", "עדכון אחרון"];
    const widths = [9, 24, 10, 9, 9, 9, 15, 15];
    const body = [], tone = [], secs = [], ranks = [];
    shownGroups.forEach((k, gi) => {
      tasks.filter((t) => catOf(t) === k).forEach((t) => {
        const st = ST[t.status] || ST.open;
        const ups = t.updates || [];
        const last = ups[ups.length - 1];
        body.push([fmt(t.created), t.desc || "", t.owner || "", fmt(t.due), st[1], fmt(t.doneAt), t.notes || "", last ? `${fmt(last.date)} – ${last.text}` : ""]);
        tone.push(t.status === "done" ? "ok" : t.status === "progress" ? "wait" : t.status === "info" ? "" : "late");
        secs.push(catName(k)); ranks.push(gi);
      });
    });
    if (!body.length) { flash("אין משימות להפקה"); return; }
    const O = boardExport.orderBy({ body, tone }, secs, ranks);
    const toneRows = H.tones === false ? null : O.tone;
    try {
      if (kind === "pdf") {
        boardExport.pdf({ title: H.title, subtitle: H.subtitle, issuedLabel: H.date, fileName: boardExport.fileName(REPORT, ""),
          head, body: O.body, widths, sections: O.secs, toneRows, noStamp: true });
      } else {
        const res = await boardExport.xlsx({ title: H.title, subtitle: [H.subtitle, H.date].filter((x) => String(x || "").trim()).join(" \u00b7 "),
          sheetName: "משימות", fileName: boardExport.fileName(REPORT, "xlsx"), head, body: O.body, sections: O.sections, widths,
          colTypes: head.map(() => "text"), toneRows });
        if (res && res.styled === false) flash("הקובץ נשמר ללא עיצוב");
      }
    } catch (e) { console.warn("[tasks] export failed", e); flash("ההפקה נכשלה"); }
  };

  if (err && !data) return html`<div className="tsk" dir="rtl"><style>${css}</style><p className="tskErr">${err}</p></div>`;
  if (!data) return html`<div className="tsk" dir="rtl"><style>${css}</style><p className="tskEmpty">טוען…</p></div>`;

  const nowIso = today();
  const updTask = tasks.find((t) => t.id === updFor);
  const logTask = tasks.find((t) => t.id === logFor);

  return html`<div className="tsk" dir="rtl"><style>${css}</style>
    ${err && html`<p className="tskErr">${err}</p>`}
    <div className="tskBar">
      <div className="sbCatBar even" style=${{ "--per": perRow }}>
        <button type="button" className=${`sbCatBtn all ${cat === "all" ? "on" : ""}`} onClick=${() => setCat("all")}>כל הקטגוריות</button>
        ${inUse.map((k) => html`<button key=${k} type="button" className=${`sbCatBtn ${cat === k ? "on" : ""}`} onClick=${() => { setCat(k); setOpenGrp((o) => ({ ...o, [k]: true })); }}>${catName(k)}</button>`)}
      </div>
      <button type="button" className="tskBtn" title=${allOpen ? "לכווץ את כל הקטגוריות" : "לפתוח את כל הקטגוריות"}
        onClick=${() => setOpenGrp(allOpen ? {} : Object.fromEntries(inUse.map((k) => [k, true])))}>
        ${allOpen ? html`<${ChevronUp} size=${15} /> כיווץ הכול` : html`<${ChevronDown} size=${15} /> פתיחת הכול`}</button>
      <div className="tskTools">
        <button type="button" className="tskBtn primary" title="משימה חדשה" onClick=${() => setNewAsk(true)}><${Plus} size=${16} strokeWidth=${2.6} /> משימה חדשה</button>
        ${onCatalogChange && html`<button type="button" className="tskBtn" title="קטגוריה חדשה (נשמרת במערכת לכל הפרויקטים)" onClick=${() => setNewCat(newCat === null ? "" : null)}><${Plus} size=${15} strokeWidth=${2.4} /> קטגוריה</button>`}
        ${boardExport && html`<${F}>
          <button type="button" className="tskBtn" title="הדפסת המשימות ל-PDF" onClick=${() => setExportAsk("pdf")}><${FileText} size=${15} /> PDF</button>
          <button type="button" className="tskBtn" title="המשימות לאקסל" onClick=${() => setExportAsk("xlsx")}><${FileSpreadsheet} size=${15} /> Excel</button><//>`}
      </div>
    </div>
    ${exportAsk && html`<${PrintLangAsk} startLang="he" titles=${tskTitles}
      onPick=${(lg, who, hdr) => { const k = exportAsk; setExportAsk(null); doExport(k, hdr); }} onClose=${() => setExportAsk(null)} />`}
    ${newCat !== null && html`<div className="tskBar">
      <input className="tskIn" style=${{ maxWidth: 320 }} autoFocus placeholder="שם הקטגוריה החדשה" value=${newCat}
        onChange=${(e) => setNewCat(e.target.value)}
        onKeyDown=${(e) => { if (e.key === "Enter") { const k = addCat(newCat); if (k) setOpenGrp((o) => ({ ...o, [k]: true })); setNewCat(null); } if (e.key === "Escape") setNewCat(null); }} />
      <button type="button" className="tskBtn primary" disabled=${!String(newCat).trim()} onClick=${() => { const k = addCat(newCat); if (k) setOpenGrp((o) => ({ ...o, [k]: true })); setNewCat(null); }}>הוספה</button>
      <button type="button" className="tskBtn" onClick=${() => setNewCat(null)}>ביטול</button>
    </div>`}
    <div className="tskWin">
      ${tasks.length === 0 && html`<p className="tskEmpty">אין עדיין משימות — לחצי על "+ משימה חדשה"</p>`}
      ${shownGroups.map((k) => {
        const list = tasks.filter((t) => catOf(t) === k);
        const open = !!openGrp[k] || cat === k;
        return html`<div key=${k} className="tskGrp">
          <div className=${`contactsAdminGroupHead tskHead ${open ? "open" : ""} ${dragK === k ? "dragging" : ""} ${dropAt && dropAt.k === k && dragK !== k ? (dropAt.pos === "after" ? "dropAfter" : "dropBefore") : ""}`.trim()}
            draggable=${k !== NONE && !!onCatalogChange}
            title=${k !== NONE && onCatalogChange ? "לגרור את הכותרת כדי לשנות את מקום הקטגוריה" : ""}
            onDragStart=${(e) => { setDragK(k); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); } catch (x) {} }}
            onDragEnd=${() => { setDragK(null); setDropAt(null); }}
            onDragOver=${(e) => {
              if (!dragK || k === NONE) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const pos = e.clientY > r.top + r.height / 2 ? "after" : "before";
              if (!dropAt || dropAt.k !== k || dropAt.pos !== pos) setDropAt({ k, pos });
            }}
            onDrop=${(e) => { e.preventDefault(); if (dragK && dropAt) moveCat(dragK, dropAt.k, dropAt.pos); setDragK(null); setDropAt(null); }}>
            ${k !== NONE && onCatalogChange && html`<span className="tskGrip" title="גרירה לשינוי הסדר"><${GripVertical} size=${15} /></span>`}
            <button type="button" className="tskHeadBtn" onClick=${() => setOpenGrp((o) => ({ ...o, [k]: !open }))}>
              ${open ? html`<${ChevronDown} size=${16} className="contactsSecChev" />` : html`<${ChevronLeft} size=${16} className="contactsSecChev" />`}
              <span>${catName(k)}</span>
            </button>
            <button type="button" className="tskAddIn" title=${`משימה נוספת ב"${catName(k)}"`} onClick=${() => setNewAsk(k === NONE ? true : k)}><${Plus} size=${14} strokeWidth=${2.6} /> משימה</button>
            ${k !== NONE && onCatalogChange && html`<button type="button" className="tskCatDel" title="מחיקת הקטגוריה מהמערכת" onClick=${() => deleteCat(k)}><${Trash2} size=${13} /></button>`}
          </div>
          ${open && html`<div className="tskTblWrap"><table>
            <colgroup><col style=${{ width: "10%" }} /><col style=${{ width: "19%" }} /><col style=${{ width: "10%" }} /><col style=${{ width: "10%" }} />
              <col style=${{ width: "9%" }} /><col style=${{ width: "10%" }} /><col style=${{ width: "15%" }} /><col style=${{ width: "8%" }} /><col style=${{ width: "6%" }} /><col style=${{ width: "3%" }} /></colgroup>
            <thead><tr><th>תאריך הקמה</th><th>תיאור</th><th>אחריות</th><th>תאריך יעד</th><th>סטטוס</th><th>תאריך ביצוע</th><th>הערות / מידע נוסף</th><th>עדכונים</th><th>RFI</th><th></th></tr></thead>
            <tbody>${list.length === 0 && html`<tr><td colSpan=${10} className="tskEmpty">אין משימות בקטגוריה — "+ משימה" בכותרת</td></tr>`}${list.map((t) => {
              const st = ST[t.status] || ST.open;
              const late = t.due && t.status !== "done" && t.status !== "info" && t.due < nowIso;
              const ups = t.updates || [];
              const last = ups[ups.length - 1];
              return html`<tr key=${t.id} className=${`${t.status === "done" ? "done" : t.status === "info" ? "info" : ""} ${late ? "late" : ""}`.trim()}>
                <td><input type="date" className="tskIn" value=${t.created || ""} onChange=${(e) => patch(t.id, { created: e.target.value })} />
                  ${t.createdBy && t.createdBy.name && html`<div className="tskBy" title=${t.createdBy.email || ""}>${t.createdBy.name}</div>`}</td>
                <td>${isFixed(t)
                  ? html`<div className="tskFixed" title="משימה קבועה בכל פרויקט">${t.desc}</div>`
                  : html`<${Area} value=${t.desc || ""} placeholder="תיאור המשימה" rows=${3} h=${(t.h || {}).desc}
                      onChange=${(v) => patch(t.id, { desc: v })} onH=${(px) => patch(t.id, { h: { ...(t.h || {}), desc: px } })} />`}</td>
                <td><input className="tskIn" list="tskPeople" value=${t.owner || ""} placeholder="אחראי/ת" onChange=${(e) => patch(t.id, { owner: e.target.value })} /></td>
                <td className="due"><input type="date" className="tskIn" value=${t.due || ""} title=${late ? "עבר תאריך היעד" : ""} onChange=${(e) => patch(t.id, { due: e.target.value })} /></td>
                <td><select className="tskIn tskSt" style=${{ color: st[2], background: st[3] }} value=${st[0]}
                  onChange=${(e) => { const v = e.target.value; const was = t.status === "done";
                    patch(t.id, { status: v, doneAt: v === "done" ? (was && t.doneAt ? t.doneAt : today()) : "", doneBy: v === "done" ? (was && t.doneBy ? t.doneBy : me) : null }); }}>
                  ${TASK_STATUS.map((s) => html`<option key=${s[0]} value=${s[0]}>${s[1]}</option>`)}</select></td>
                <td><input type="date" className="tskIn" value=${t.doneAt || ""} title="נכתב לבד כשהסטטוס הופך ל'בוצע'" onChange=${(e) => patch(t.id, { doneAt: e.target.value })} />
                  ${t.status === "done" && t.doneBy && t.doneBy.name && html`<div className="tskBy" title=${t.doneBy.email || ""}>${t.doneBy.name}</div>`}</td>
                <td><${Area} value=${t.notes || ""} placeholder="הערות / מידע נוסף" rows=${isFixed(t) ? 2 : 3} h=${(t.h || {}).notes}
                  onChange=${(v) => patch(t.id, { notes: v })} onH=${(px) => patch(t.id, { h: { ...(t.h || {}), notes: px } })} /></td>
                <td><div className="tskUpd">
                  <button type="button" className="tskBtn icon" title="עדכון חדש" onClick=${() => setUpdFor(t.id)}><${Plus} size=${14} strokeWidth=${2.6} /></button>
                  <button type="button" className="tskBtn icon" title=${last ? `רשימת עדכונים · אחרון: ${fmt(last.date)}` : "רשימת עדכונים"} disabled=${!ups.length}
                    onClick=${() => setLogFor(t.id)}><${History} size=${14} />${ups.length ? html`<span style=${{ fontSize: 11.5 }}>${ups.length}</span>` : null}</button>
                </div>${last && html`<div className="tskUpd"><span className="last" title=${last.text}>${fmt(last.date)}</span></div>`}</td>
                <td>${onCreateRfi && html`<button type="button" className=${`tskRfi ${t.rfi ? "on" : ""}`} title=${t.rfi ? `נפתח RFI ${t.rfi.no} — לחיצה פותחת RFI נוסף` : "פתיחת שורה בלחצן RFI ללקוח / פיקוח"}
                    onClick=${() => toRfi(t)}>${t.rfi ? `RFI ${t.rfi.no}` : "RFI"}</button>`}</td>
                <td>${!(isFixed(t)) && html`<button type="button" className="tskBtn icon" style=${{ border: 0 }} title="מחיקת המשימה" onClick=${() => remove(t)}><${Trash2} size=${14} color="#b02a37" /></button>`}</td>
              </tr>`;
            })}</tbody>
          </table></div>`}
        </div>`;
      })}
    </div>
    <datalist id="tskPeople">${people.map((p) => html`<option key=${p} value=${p} />`)}</datalist>
    <div className="tskSave">
      <button type="button" className="tskBtn primary" onClick=${() => { dirtyRef.current = true; saveNow(); }}><${Save} size=${15} /> שמירה</button>
      ${saveState === "saving" && html`<span className="tskSaved" style=${{ color: "#5b5e66" }}>שומר…</span>`}
      ${saveState === "saved" && html`<span className="tskSaved">נשמר ✓</span>`}
    </div>
    ${newAsk && html`<${NewTask} cats=${cats} start=${typeof newAsk === "string" ? newAsk : cat !== "all" && cat !== NONE ? cat : ""} onAddCat=${addCat} onCreate=${create} onClose=${() => setNewAsk(false)} />`}
    ${updTask && html`<${AddUpdate} task=${updTask} onClose=${() => setUpdFor(null)}
      onSave=${(u) => { patch(updTask.id, { updates: [...(updTask.updates || []), { id: uid("u"), by: currentEmail || "", ...u }] }); setUpdFor(null); flash("העדכון נשמר"); }} />`}
    ${logTask && html`<${UpdateLog} task=${logTask} onClose=${() => setLogFor(null)}
      onRemove=${(uidv) => { if (confirm("למחוק את העדכון?")) patch(logTask.id, { updates: (logTask.updates || []).filter((u) => u.id !== uidv), updGone: Array.from(new Set((logTask.updGone || []).concat([uidv]))) }); }} />`}
    ${toast && html`<div className="tskToast">${toast}</div>`}
  </div>`;
}

// 06.11.26 — a text box three lines tall to begin with; when she drags it
// taller, the height is kept with the task and it opens that way next time.
function Area({ value, onChange, placeholder, rows, h, onH }) {
  const ref = useRef(null);
  const base = useRef(0);
  useEffect(() => { if (ref.current && !h) base.current = Math.round(ref.current.offsetHeight); }, []);
  // A drag of the corner ends with the mouse let go on the box: if its height
  // changed, that height is hers.
  const check = () => {
    const el = ref.current;
    if (!el || !onH) return;
    const px = Math.round(el.offsetHeight);
    const was = h || base.current;
    if (was && Math.abs(px - was) > 2) onH(px);
  };
  return html`<textarea ref=${ref} className="tskIn tskArea" rows=${rows || 3} value=${value} placeholder=${placeholder}
    style=${h ? { height: h + "px" } : null} onChange=${(e) => onChange(e.target.value)} onMouseUp=${check} />`;
}

// A new task: its category (from the library, or a new one typed here — it
// joins the library) and what it is.
function NewTask({ cats, start, onAddCat, onCreate, onClose }) {
  const [c, setC] = useState(start || (cats[0] || {}).key || "");
  const [typed, setTyped] = useState("");
  const [desc, setDesc] = useState("");
  const go = () => {
    let k = c;
    if (c === "__new__") k = onAddCat(typed) || "";
    onCreate(k, desc.trim());
  };
  return html`<div className="tskScrim" onClick=${onClose}><div className="tskPop" dir="rtl" onClick=${(e) => e.stopPropagation()}>
    <button type="button" className="x" title="סגירה" onClick=${onClose}><${X} size=${17} /></button>
    <h3>משימה חדשה</h3>
    <div className="sub">תאריך הקמה: ${fmt(today())}</div>
    <label>קטגוריה
      <select className="tskIn" value=${c} onChange=${(e) => setC(e.target.value)}>
        ${cats.length === 0 && html`<option value="">ללא קטגוריה</option>`}
        ${cats.map((x) => html`<option key=${x.key} value=${x.key}>${x.he}</option>`)}
        <option value="__new__">+ קטגוריה חדשה…</option>
      </select>
      ${c === "__new__" && html`<input className="tskIn" autoFocus placeholder="שם הקטגוריה (תתווסף למאגר)" value=${typed} onChange=${(e) => setTyped(e.target.value)} />`}
    </label>
    <label>תיאור
      <textarea className="tskIn" rows=${3} autoFocus=${c !== "__new__"} value=${desc} onChange=${(e) => setDesc(e.target.value)} placeholder="מה צריך לעשות" />
    </label>
    <div className="row">
      <button type="button" className="tskBtn primary" disabled=${c === "__new__" && !typed.trim()} onClick=${go}><${Plus} size=${15} /> יצירת משימה</button>
      <button type="button" className="tskBtn" onClick=${onClose}>ביטול</button>
    </div>
  </div></div>`;
}

// The small "+" window: today's date by itself, and the update.
function AddUpdate({ task, onSave, onClose }) {
  const [text, setText] = useState("");
  const d = today();
  return html`<div className="tskScrim" onClick=${onClose}><div className="tskPop" dir="rtl" onClick=${(e) => e.stopPropagation()}>
    <button type="button" className="x" title="סגירה" onClick=${onClose}><${X} size=${17} /></button>
    <h3>עדכון חדש</h3>
    <div className="sub">${String(task.desc || "").slice(0, 90)}</div>
    <label>תאריך העדכון<input className="tskIn" value=${fmt(d)} readOnly style=${{ background: "#f4f6f9", fontWeight: 800 }} /></label>
    <label>העדכון<textarea className="tskIn" rows=${4} autoFocus value=${text} onChange=${(e) => setText(e.target.value)} placeholder="מה התעדכן" /></label>
    <div className="row">
      <button type="button" className="tskBtn primary" disabled=${!text.trim()} onClick=${() => onSave({ date: d, text: text.trim() })}><${Save} size=${15} /> שמירת עדכון</button>
      <button type="button" className="tskBtn" onClick=${onClose}>ביטול</button>
    </div>
  </div></div>`;
}

// The updates saved on a task, newest first.
function UpdateLog({ task, onRemove, onClose }) {
  const ups = (task.updates || []).slice().reverse();
  return html`<div className="tskScrim" onClick=${onClose}><div className="tskPop" dir="rtl" onClick=${(e) => e.stopPropagation()}>
    <button type="button" className="x" title="סגירה" onClick=${onClose}><${X} size=${17} /></button>
    <h3>רשימת עדכונים</h3>
    <div className="sub">${String(task.desc || "").slice(0, 90)}</div>
    <div className="tskLog">${ups.map((u) => html`<div key=${u.id} className="it">
      <div className="d">${fmt(u.date)}<button type="button" title="מחיקת העדכון" onClick=${() => onRemove(u.id)}><${Trash2} size=${13} /></button></div>
      <div className="t">${u.text}</div></div>`)}</div>
  </div></div>`;
}
