// =============================================================================
//  tasks/admin.js — ניהול משימות (task management). A. Weiss dashboard
//  tasks build 1 · 06.11.2026 (site: build 257)
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
import { Plus, X, Save, ChevronDown, ChevronLeft, Trash2, History, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { supabase } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;
export const TASKS_BUILD = "tasks build 3 · 06.11.2026";
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
];
const FIXED_CAT_KEYS = new Set(FIXED_CATS.map((c) => c.key));
const FIXED_DEFS = [];
FIXED_CATS.forEach((c) => c.tasks.forEach(([id, desc]) => FIXED_DEFS.push({ id, desc, category: c.key })));
const FIXED_IDS = new Set(FIXED_DEFS.map((d) => d.id));
// The fixed tasks a project does not have yet are added; the fixed ones come
// first in their order, then hers as they were.
function withFixed(tasks) {
  const have = new Set(tasks.map((t) => t.id));
  const add = FIXED_DEFS.filter((d) => !have.has(d.id)).map((d) => ({
    id: d.id, fixed: true, category: d.category, created: today(), desc: d.desc, owner: "", due: "", status: "open", notes: "", updates: []
  }));
  if (!add.length) return tasks;
  const all = add.concat(tasks);
  const fx = FIXED_DEFS.map((d) => all.find((t) => t.id === d.id)).filter(Boolean);
  return fx.concat(all.filter((t) => !FIXED_IDS.has(t.id)));
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
.tsk{font-family:'Assistant','Inter',sans-serif;color:var(--ink,#17181c);font-size:14px;max-width:1180px;margin:0 auto;padding:0 16px 28px}
.tsk .tskBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:8px 12px;margin-bottom:10px}
.tsk .tskBar .sbCatBar{margin:0;flex:1 1 auto}
.tsk .tskBtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:9px;border:1px solid var(--line,#e6e6e9);background:#fff;color:var(--ink,#17181c);cursor:pointer;white-space:nowrap}
.tsk .tskBtn:hover{border-color:var(--accent,#17181c)}
.tsk .tskBtn.primary{background:var(--accent,#14265e);border-color:var(--accent,#14265e);color:#fff}
.tsk .tskBtn.icon{padding:5px 7px}
.tsk .tskBtn:disabled{opacity:.45;cursor:default}
.tsk .tskWin{background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:12px}
.tsk .tskGrp{margin-bottom:12px}
.tsk .tskHead{width:100%;box-sizing:border-box;gap:6px}
.tsk .tskHead.drop{outline:2px dashed var(--accent,#14265e);outline-offset:-2px}
.tsk .tskHeadBtn{flex:1 1 auto;display:flex;align-items:center;gap:8px;border:0;background:none;cursor:pointer;font:inherit;font-weight:800;color:inherit;text-align:start;padding:0}
.tsk .tskAddIn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line,#e6e6e9);background:#fff;border-radius:7px;cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:2px 8px;color:#3f434b}
.tsk .tskAddIn:hover{border-color:var(--accent,#14265e)}
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
.tsk tr.done .tskIn{background:transparent}
.tsk select.tskSt{font-weight:800;border-radius:99px;text-align:center;padding:4px 6px;border:0}
.tsk select.tskSt option{background:#fff;color:#17181c}
.tsk .tskUpd{display:flex;align-items:center;justify-content:center;gap:4px}
.tsk .tskUpd .last{font-size:11px;color:#5b5e66;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tsk .tskFixed{text-align:start;font-weight:700;padding:5px 7px;font-size:13px}
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

export function TasksBoard({ projectId, projectName, currentEmail, catalog, onCatalogChange, contacts }) {
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
      d.tasks = withFixed(d.tasks);
      console.info("[tasks] loaded", projectId, d.tasks.length);
      setData(d); setLoadedFor(projectId);
    })();
    return () => { off = true; };
  }, [projectId]);

  // ---------------------------------------------------------------- save
  const saveNow = async () => {
    clearTimeout(timerRef.current);
    if (!dirtyRef.current || loadedFor !== projectId || !dataRef.current) return;
    const run = ++runRef.current;
    const payload = dataRef.current;
    dirtyRef.current = false;
    setSaveState("saving");
    const { error } = await supabase.from("project_tasks").upsert(
      { project_id: projectId, data: payload, updated_at: new Date().toISOString(), updated_by: currentEmail || null },
      { onConflict: "project_id" });
    if (run !== runRef.current) return;
    if (error) {
      console.warn("[tasks] save failed", error);
      dirtyRef.current = true;
      setSaveState(""); setErr("השמירה נכשלה: " + (error.message || ""));
      return;
    }
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
  // The site-opening category is always in the library — first, until she moves it.
  useEffect(() => {
    if (!onCatalogChange || !catalog) return;
    const list = (catalog.taskCats || []);
    const missing = FIXED_CATS.filter((f) => !list.some((c) => c && c.key === f.key)).map((f) => ({ key: f.key, he: f.he, fixed: true }));
    if (missing.length) onCatalogChange({ ...catalog, taskCats: list.concat(missing) });
  }, [catalog && (catalog.taskCats || []).length]);
  const rawCats = ((catalog || {}).taskCats || []).filter((c) => c && c.key && String(c.he || "").trim());
  const cats = rawCats.concat(FIXED_CATS.filter((f) => !rawCats.some((c) => c.key === f.key)).map((f) => ({ key: f.key, he: f.he, fixed: true })));
  const catName = (k) => (k === NONE ? "ללא קטגוריה" : ((cats.find((c) => c.key === k) || {}).he || "ללא קטגוריה"));
  const tasks = (data && data.tasks) || [];
  const catOf = (t) => (t.category && cats.some((c) => c.key === t.category) ? t.category : NONE);
  // The groups in the library's order; only the ones with tasks, as on the other boards.
  // The categories with tasks — and the fixed ones always, even when empty
  // ("הוראות שינוי"), so their "+ משימה" is there.
  const inUse = cats.filter((c) => FIXED_CAT_KEYS.has(c.key) || tasks.some((t) => catOf(t) === c.key)).map((c) => c.key)
    .concat(tasks.some((t) => catOf(t) === NONE) ? [NONE] : []);
  const shownGroups = cat === "all" ? inUse : inUse.filter((k) => k === cat);
  useEffect(() => { if (cat !== "all" && !inUse.includes(cat)) setCat("all"); }, [inUse.join("|")]);

  const people = useMemo(() => {
    const out = new Set();
    (contacts || []).forEach((c) => { const n = (c.person && (c.person.he || c.person.en)) || ""; if (n.trim()) out.add(n.trim()); });
    tasks.forEach((t) => { if (String(t.owner || "").trim()) out.add(t.owner.trim()); });
    return Array.from(out).sort();
  }, [contacts, tasks]);

  const patch = (id, p) => edit((d) => { d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)); return d; });
  const remove = (t) => {
    if (t.fixed || FIXED_IDS.has(t.id)) return;
    if (!confirm(`למחוק את המשימה "${String(t.desc || "").slice(0, 60) || "ללא תיאור"}"?`)) return;
    edit((d) => { d.tasks = d.tasks.filter((x) => x.id !== t.id); return d; });
  };
  const create = (category, desc) => {
    const t = { id: uid("t"), category: category || "", created: today(), desc: desc || "", owner: "", due: "", status: "open", notes: "", updates: [] };
    edit((d) => { d.tasks = [...d.tasks, t]; return d; });
    setOpenGrp((o) => ({ ...o, [category || NONE]: true }));
    setNewAsk(false);
    flash("המשימה נוספה");
  };
  // 06.11.26 — the groups move up and down among themselves (closed or open):
  // she decides which comes first. The order is the library's, so every
  // project shows them the same way.
  const [dragK, setDragK] = useState(null);
  const moveCat = (k, toK) => {
    if (!onCatalogChange || k === NONE || toK === NONE || k === toK) return;
    const all = ((catalog || {}).taskCats || []).slice();
    const from = all.findIndex((c) => c.key === k);
    const to = all.findIndex((c) => c.key === toK);
    if (from < 0 || to < 0) return;
    const [x] = all.splice(from, 1);
    all.splice(to, 0, x);
    onCatalogChange({ ...(catalog || {}), taskCats: all });
  };
  const stepCat = (k, d) => {
    const real = inUse.filter((x) => x !== NONE);
    const i = real.indexOf(k), j = i + d;
    if (i < 0 || j < 0 || j >= real.length) return;
    moveCat(k, real[j]);
  };
  const addCat = (name) => {
    const v = String(name || "").trim();
    if (!v || !onCatalogChange) return "";
    const hit = cats.find((c) => c.he.trim() === v);
    if (hit) return hit.key;
    const key = `tc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    onCatalogChange({ ...(catalog || {}), taskCats: [...((catalog || {}).taskCats || []), { key, he: v }] });
    return key;
  };

  if (err && !data) return html`<div className="tsk" dir="rtl"><style>${css}</style><p className="tskErr">${err}</p></div>`;
  if (!data) return html`<div className="tsk" dir="rtl"><style>${css}</style><p className="tskEmpty">טוען…</p></div>`;

  const nowIso = today();
  const updTask = tasks.find((t) => t.id === updFor);
  const logTask = tasks.find((t) => t.id === logFor);

  return html`<div className="tsk" dir="rtl"><style>${css}</style>
    ${err && html`<p className="tskErr">${err}</p>`}
    <div className="tskBar">
      <button type="button" className="tskBtn primary" title="משימה חדשה" onClick=${() => setNewAsk(true)}><${Plus} size=${16} strokeWidth=${2.6} /> משימה חדשה</button>
      <div className="sbCatBar">
        <button type="button" className=${`sbCatBtn all ${cat === "all" ? "on" : ""}`} onClick=${() => setCat("all")}>כל הקטגוריות</button>
        ${inUse.map((k) => html`<button key=${k} type="button" className=${`sbCatBtn ${cat === k ? "on" : ""}`} onClick=${() => { setCat(k); setOpenGrp((o) => ({ ...o, [k]: true })); }}>${catName(k)}</button>`)}
      </div>
    </div>
    <div className="tskWin">
      ${tasks.length === 0 && html`<p className="tskEmpty">אין עדיין משימות — לחצי על "+ משימה חדשה"</p>`}
      ${shownGroups.map((k) => {
        const list = tasks.filter((t) => catOf(t) === k);
        const open = !!openGrp[k] || cat === k;
        return html`<div key=${k} className="tskGrp">
          <div className=${`contactsAdminGroupHead tskHead ${open ? "open" : ""} ${dragK && dragK !== k && k !== NONE ? "drop" : ""}`.trim()}
            draggable=${k !== NONE && !!onCatalogChange}
            onDragStart=${(e) => { setDragK(k); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); } catch (x) {} }}
            onDragEnd=${() => setDragK(null)}
            onDragOver=${(e) => { if (dragK && k !== NONE) e.preventDefault(); }}
            onDrop=${(e) => { e.preventDefault(); if (dragK) moveCat(dragK, k); setDragK(null); }}>
            ${k !== NONE && onCatalogChange && html`<span className="tskGrip" title="גרירה לשינוי הסדר"><${GripVertical} size=${15} /></span>`}
            <button type="button" className="tskHeadBtn" onClick=${() => setOpenGrp((o) => ({ ...o, [k]: !open }))}>
              ${open ? html`<${ChevronDown} size=${16} className="contactsSecChev" />` : html`<${ChevronLeft} size=${16} className="contactsSecChev" />`}
              <span>${catName(k)}</span>
            </button>
            <button type="button" className="tskAddIn" title=${`משימה נוספת ב"${catName(k)}"`} onClick=${() => setNewAsk(k === NONE ? true : k)}><${Plus} size=${14} strokeWidth=${2.6} /> משימה</button>
            ${k !== NONE && onCatalogChange && cat === "all" && html`<span className="tskMove">
              <button type="button" title="למעלה" disabled=${inUse.indexOf(k) === 0} onClick=${() => stepCat(k, -1)}><${ArrowUp} size=${14} /></button>
              <button type="button" title="למטה" disabled=${inUse.filter((x) => x !== NONE).indexOf(k) === inUse.filter((x) => x !== NONE).length - 1} onClick=${() => stepCat(k, 1)}><${ArrowDown} size=${14} /></button>
            </span>`}
          </div>
          ${open && html`<div className="tskTblWrap"><table>
            <colgroup><col style=${{ width: "10%" }} /><col style=${{ width: "24%" }} /><col style=${{ width: "12%" }} /><col style=${{ width: "11%" }} />
              <col style=${{ width: "10%" }} /><col style=${{ width: "18%" }} /><col style=${{ width: "12%" }} /><col style=${{ width: "3%" }} /></colgroup>
            <thead><tr><th>תאריך הקמה</th><th>תיאור</th><th>אחריות</th><th>תאריך יעד</th><th>סטטוס</th><th>הערות / מידע נוסף</th><th>עדכונים</th><th></th></tr></thead>
            <tbody>${list.length === 0 && html`<tr><td colSpan=${8} className="tskEmpty">אין משימות בקטגוריה — "+ משימה" בכותרת</td></tr>`}${list.map((t) => {
              const st = ST[t.status] || ST.open;
              const late = t.due && t.status !== "done" && t.status !== "info" && t.due < nowIso;
              const ups = t.updates || [];
              const last = ups[ups.length - 1];
              return html`<tr key=${t.id} className=${`${t.status === "done" ? "done" : t.status === "info" ? "info" : ""} ${late ? "late" : ""}`.trim()}>
                <td><input type="date" className="tskIn" value=${t.created || ""} onChange=${(e) => patch(t.id, { created: e.target.value })} /></td>
                <td>${t.fixed || FIXED_IDS.has(t.id)
                  ? html`<div className="tskFixed" title="משימה קבועה בכל פרויקט">${t.desc}</div>`
                  : html`<textarea className="tskIn" rows=${1} value=${t.desc || ""} placeholder="תיאור המשימה" onChange=${(e) => patch(t.id, { desc: e.target.value })} />`}</td>
                <td><input className="tskIn" list="tskPeople" value=${t.owner || ""} placeholder="אחראי/ת" onChange=${(e) => patch(t.id, { owner: e.target.value })} /></td>
                <td className="due"><input type="date" className="tskIn" value=${t.due || ""} title=${late ? "עבר תאריך היעד" : ""} onChange=${(e) => patch(t.id, { due: e.target.value })} /></td>
                <td><select className="tskIn tskSt" style=${{ color: st[2], background: st[3] }} value=${st[0]} onChange=${(e) => patch(t.id, { status: e.target.value })}>
                  ${TASK_STATUS.map((s) => html`<option key=${s[0]} value=${s[0]}>${s[1]}</option>`)}</select></td>
                <td><textarea className="tskIn" rows=${1} value=${t.notes || ""} placeholder="הערות / מידע נוסף" onChange=${(e) => patch(t.id, { notes: e.target.value })} /></td>
                <td><div className="tskUpd">
                  <button type="button" className="tskBtn icon" title="עדכון חדש" onClick=${() => setUpdFor(t.id)}><${Plus} size=${14} strokeWidth=${2.6} /></button>
                  <button type="button" className="tskBtn icon" title=${last ? `רשימת עדכונים · אחרון: ${fmt(last.date)}` : "רשימת עדכונים"} disabled=${!ups.length}
                    onClick=${() => setLogFor(t.id)}><${History} size=${14} />${ups.length ? html`<span style=${{ fontSize: 11.5 }}>${ups.length}</span>` : null}</button>
                </div>${last && html`<div className="tskUpd"><span className="last" title=${last.text}>${fmt(last.date)}</span></div>`}</td>
                <td>${!(t.fixed || FIXED_IDS.has(t.id)) && html`<button type="button" className="tskBtn icon" style=${{ border: 0 }} title="מחיקת המשימה" onClick=${() => remove(t)}><${Trash2} size=${14} color="#b02a37" /></button>`}</td>
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
      onRemove=${(uidv) => { if (confirm("למחוק את העדכון?")) patch(logTask.id, { updates: (logTask.updates || []).filter((u) => u.id !== uidv) }); }} />`}
    ${toast && html`<div className="tskToast">${toast}</div>`}
  </div>`;
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
