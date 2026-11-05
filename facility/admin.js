// =============================================================================
//  facility/admin.js — תיק מתקן (Facility File). A. Weiss dashboard
//  facility build 1 · 28.10.2026 (site: build 224)
//
//  The dashboard loads this file when the administrator opens the cube that
//  used to be "Contacts". Contacts now live INSIDE it, as chapter 1 — the
//  dashboard hands the existing contacts table in as `contactsNode`, unchanged.
//
//  Nine chapters, each a square button (her layout, 28.10.26):
//    1 אנשי קשר                      the existing contacts table
//    2 רשימת חומרי גמר               checklist
//    3 ת"י 921 + אחריות ותחזוקה      suppliers she adds by hand; five ticks each,
//                                     service-department details with a PDF,
//                                     and the request text to e-mail or copy
//    4 אישורי מכון התקנים            checklist + add
//    5 אישורי מתכננים                checklist + add + e-mail
//    6 אישורי קבלנים/מבצעים והצהרות  checklist + add + e-mail
//    7 אישור כבאות לאכלוס            checklist
//    8 תיקי מתקן – קבלני מערכות      checklist + add
//    9 תוכניות AS MADE               one tick per floor
//
//  Every row: V turns it green, "לא רלוונטי" greys it out and takes it out of
//  the count.
//
//  Storage: one row per project in public.facility_files (see
//  supabase/001_facility.sql), administrator only. Never app_state.
//  Saving follows the rule learned 14.10.26: write only what was edited, only
//  for the project that was loaded, and a run that has been overtaken stops.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";
import {
  Phone, Layers, ShieldCheck, BadgeCheck, PenTool, HardHat, Flame, FolderOpen, Map as MapIcon,
  Plus, Mail, Copy, Trash2, Printer, Pencil, Save, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { supabase, printSheetCss, printedStampText } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;   // a template with more than one root returns an array without keys
export const FACILITY_BUILD = "facility build 1 · 28.10.2026";
if (typeof console !== "undefined") console.info(FACILITY_BUILD);

// ----------------------------------------------------------------------------- the chapters
const CHAPTERS = [
  { k: "contacts", n: 1, he: "אנשי קשר", icon: Phone, color: "#0EA5E9", kind: "contacts" },
  { k: "finishes", n: 2, he: "רשימת חומרי גמר", icon: Layers, color: "#8B5E3C", kind: "check", items: [
    ["fin-light", "גופי תאורה"], ["fin-sanitary", "כלים סניטריים"], ["fin-taps", "ברזי מים או סודה"],
    ["fin-floor", "ריצופים"], ["fin-clad", "חיפויים"], ["fin-ceil", "תקרות"],
    ["fin-fire", "אביזרי קצה – גילוי אש"], ["fin-sockets", "אביזרי קצה – שקעים ומתגים"], ["fin-hvac", "אביזרי קצה – מיזוג אוויר"],
  ] },
  { k: "warranty", n: 3, he: "ת\"י 921 + אחריות ותחזוקה", icon: ShieldCheck, color: "#1A7F4B", kind: "suppliers" },
  { k: "standards", n: 4, he: "אישורי מכון התקנים", icon: BadgeCheck, color: "#2563EB", kind: "check", add: "הוספת אישור מכון תקנים", items: [
    ["si-931", "931 – אטומי אש"], ["si-1001", "1001 – מיזוג אוויר"], ["si-1001-7", "1001-7 – מיזוג אוויר"],
    ["si-1212", "1212 – אישור התקנה"], ["si-1220", "1220 – גילוי אש"], ["si-1596", "1596 – ספרינקלרים"],
    ["si-1597", "1597 – כיבוי בגז"], ["si-2206", "2206 – גלגלונים"], ["si-integ", "אינטגרציה"],
    ["si-elec-run", "בדיקות חשמל להרצת מערכות"], ["si-ceil-load", "בדיקת העמסת תקרות"], ["si-hvac-water", "בדיקת מי מיזוג"],
  ] },
  { k: "designers", n: 5, he: "אישורי מתכננים", icon: PenTool, color: "#7C3AED", kind: "check", add: "הוספת יועץ / מתכנן", mail: true, items: [
    ["ds-arch", "אדריכל מבצע"], ["ds-plumb", "יועץ אינסטלציה"], ["ds-acou", "יועץ אקוסטיקה"], ["ds-fire", "יועץ בטיחות אש"],
    ["ds-elec", "יועץ חשמל"], ["ds-hvac", "יועץ מיזוג אוויר"], ["ds-access", "יועץ נגישות"],
    ["ds-struct", "יועץ קונסטרוקציה ומדרגות"], ["ds-sustain", "יועץ קיימות"], ["ds-light", "יועץ תאורה"],
  ] },
  { k: "contractors", n: 6, he: "אישורי קבלנים/מבצעים והצהרות", icon: HardHat, color: "#E8B10A", kind: "check", add: "הוספת קבלן / מבצע", mail: true, items: [
    ["ct-main", "קבלן ראשי – א. וייס"], ["ct-water", "קבלן מערכות מים וביוב"], ["ct-elec", "קבלן חשמל, בודק חשמל ולוחות חשמל"],
    ["ct-hvac", "קבלן מיזוג אוויר"], ["ct-curtain", "קבלן וילונות אש"], ["ct-firestop", "מבצע אטומי אש"],
  ] },
  { k: "fire", n: 7, he: "אישור כבאות לאכלוס", icon: Flame, color: "#C0392B", kind: "check", items: [
    ["fd-safety", "אישור יועץ בטיחות"], ["fd-ops", "משטר הפעלות"],
  ] },
  { k: "systems", n: 8, he: "תיקי מתקן – קבלני מערכות", icon: FolderOpen, color: "#EA7317", kind: "check", add: "הוספת קבלן מערכות", items: [
    ["sy-plumb", "תיק מתקן קבלן אינסטלציה"], ["sy-elec", "תיק מתקן קבלן חשמל"], ["sy-hvac", "תיק מתקן קבלן מיזוג אוויר"],
  ] },
  { k: "asmade", n: 9, he: "תוכניות AS MADE", icon: MapIcon, color: "#0E7490", kind: "asmade", items: [
    ["am-build", "תוכניות בינוי"], ["am-fin", "תוכניות גמרים"], ["am-layout", "תוכניות העמדה"],
    ["am-ftc", "תוכניות FTC"], ["am-floor", "תוכניות ריצוף"], ["am-ceil", "תוכניות תקרה"],
  ] },
];
const CH = Object.fromEntries(CHAPTERS.map((c) => [c.k, c]));

// Chapter 3 — the five things asked of every supplier (her order).
const SUP_COLS = [["s755", "ת\"י 755"], ["s921", "ת\"י 921"], ["warranty", "כתב אחריות"], ["service", "פרטי מחלקת בדק"], ["maint", "הוראות תחזוקה ואחזקה"]];

// Her text, word for word (28.10.26).
const MSG_921 = `שלום
לצורך השלמת תיק המתקן של הפרויקט, אבקש להעביר עבור כלל הציוד,
המוצרים והעבודות שסופקו ו/או בוצעו על ידכם את המסמכים והמידע הבאים:

* אישורי מכון התקנים ו/או תעודות בדיקה וסיווג בהתאם לת״י 755 ות״י 921, ככל שרלוונטי.
* הוראות תחזוקה ואחזקה שוטפת
* כתב אחריות
* פרטי מחלקת הבדק והשירות מטעמכם:
   * שם איש קשר
   * מספר נייד
   * מספר טלפון
   * כתובת מייל

במידה וסופקו מספר מוצרים או בוצעו מספר סוגי עבודות במסגרת הפרויקט,
אבקש להעביר את המסמכים עבור כל מוצר או עבודה בנפרד ובאופן ברור.
ככל שאחד מהמסמכים או התקנים אינו רלוונטי למוצר או לעבודה שסופקו על ידכם,
אבקש לציין זאת במפורש.

בברכה,`;
// Chapters 5 and 6: she will word these later. Until then a plain placeholder,
// editable from the screen ("עריכת נוסח") and saved with the project.
const MSG_DEFAULT = {
  designers: `שלום
לצורך השלמת תיק המתקן של הפרויקט, אבקש להעביר אישור חתום מטעמכם כי העבודות בתחום אחריותכם בוצעו בהתאם לתוכניות ולמפרט.

בברכה,`,
  contractors: `שלום
לצורך השלמת תיק המתקן של הפרויקט, אבקש להעביר הצהרה חתומה מטעמכם כי העבודות שבוצעו על ידכם בוצעו בהתאם לתוכניות, למפרט ולדרישות בטיחות האש.

בברכה,`,
};

const blank = () => ({ v: 1, items: {}, custom: {}, suppliers: [], floors: null, asMade: {}, msgs: {} });
const uid = () => Math.random().toString(36).slice(2, 10);

// Floors for AS MADE: the project's own range when it is short enough to be a
// list of floors that will be handed over; otherwise she types them.
function floorsFromProject(project) {
  const a = parseInt(String(project?.floorsFrom ?? "").trim(), 10);
  const b = parseInt(String(project?.floorsTo ?? "").trim(), 10);
  if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a < 12) return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  if (Number.isFinite(a) && !Number.isFinite(b)) return [String(a)];
  return [];
}

// ----------------------------------------------------------------------------- counting
function chapterItems(data, ch) {
  const fixed = (ch.items || []).map(([id, label]) => ({ id, label, custom: false }));
  const extra = ((data.custom || {})[ch.k] || []).map((x) => ({ id: x.id, label: x.label, custom: true }));
  return fixed.concat(extra);
}
function supRowState(s) {
  const cells = SUP_COLS.map(([k]) => (s.cells || {})[k] || "");
  if (cells.every((c) => c === "na")) return "na";
  if (cells.every((c) => c === "v" || c === "na")) return "done";
  return "open";
}
function progressOf(data, ch, floors, contactsCount) {
  if (ch.kind === "contacts") return { label: contactsCount ? `${contactsCount} אנשי קשר` : "", done: 0, total: 0 };
  if (ch.kind === "suppliers") {
    const rows = (data.suppliers || []).map(supRowState).filter((s) => s !== "na");
    return { done: rows.filter((s) => s === "done").length, total: rows.length };
  }
  if (ch.kind === "asmade") {
    let done = 0, total = 0;
    (ch.items || []).forEach(([id]) => {
      const st = (data.asMade || {})[id] || {};
      if (st.na) return;
      floors.forEach((f) => { total++; if ((st.floors || {})[f]) done++; });
    });
    return { done, total };
  }
  const st = data.items || {};
  const rel = chapterItems(data, ch).filter((it) => !(st[it.id] || {}).na);
  return { done: rel.filter((it) => (st[it.id] || {}).done).length, total: rel.length };
}

// ----------------------------------------------------------------------------- styles
const css = `
.fac{font-family:'Assistant','Inter',sans-serif;color:var(--ink,#17181c);font-size:14px;max-width:1100px;margin:0 auto;padding:0 16px 28px}
.fac .facHead{display:flex;align-items:center;justify-content:center;gap:10px;margin:4px 0 12px;flex-wrap:wrap;text-align:center}
.fac .facHead h2{font-size:19px;font-weight:800;margin:0}
.fac .facHead .facSub{font-size:12.5px;color:var(--steel,#5b5e66);font-weight:600}
.fac .cardGrid{padding-inline:0}
.fac .facProg{width:100%;height:4px;border-radius:99px;background:var(--line-soft,#f0f0f2);overflow:hidden;margin-top:4px}
.fac .facProg>i{display:block;height:100%;background:#43a06b}
.fac .facCount{font-size:10.5px;color:var(--mist,#9a9da5);font-weight:600;margin-top:2px}
.fac .dashCard.facAllDone{border-color:#9fd3ae;background:#f2faf4}
.fac .facBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:8px 12px;margin-bottom:10px}
.fac .facBar .facTitle{font-weight:800;font-size:15px;margin-inline-end:auto;display:flex;align-items:center;gap:8px}
.fac .facBtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;padding:6px 12px;border-radius:9px;border:1px solid var(--line,#e6e6e9);background:#fff;color:var(--ink,#17181c);cursor:pointer}
.fac .facBtn:hover{border-color:var(--accent,#17181c)}
.fac .facBtn.primary{background:var(--accent,#17181c);border-color:var(--accent,#17181c);color:#fff}
.fac .facBtn.icon{padding:6px 8px}
.fac .facBtn:disabled{opacity:.45;cursor:default}
.fac .facWin{background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:12px;overflow:auto}
.fac table{border-collapse:collapse;width:100%}
.fac th{background:#f4f6f9;font-weight:800;font-size:12.5px;padding:8px 10px;border-bottom:1px solid var(--line,#e6e6e9);white-space:nowrap;text-align:center}
.fac td{padding:7px 10px;border-bottom:1px solid var(--line,#e6e6e9);text-align:center;vertical-align:middle;font-size:13.5px}
.fac td.lbl{text-align:start;font-weight:600}
.fac td.num{color:var(--mist,#9a9da5);width:44px;font-variant-numeric:tabular-nums}
.fac tr.ok td{background:#e3f3e6}
.fac tr.na td{background:#f4f4f6;color:#a6a9b0}
.fac tr.na td.lbl{text-decoration:line-through;text-decoration-color:#c9ccd2}
.fac input[type=checkbox]{width:17px;height:17px;cursor:pointer;accent-color:#1f7a3e}
.fac tr.na input.doneBox{cursor:not-allowed}
.fac input.naBox{accent-color:#8a8d94}
.fac .facIn{width:100%;min-width:90px;border:1px solid var(--line,#e6e6e9);border-radius:7px;padding:5px 8px;font:inherit;font-size:13px;background:#fff}
.fac tr.na .facIn{background:transparent;color:inherit}
.fac .tri{min-width:34px;height:28px;border-radius:7px;border:1px solid var(--line,#e6e6e9);background:#fff;font:inherit;font-weight:800;cursor:pointer;color:#1f7a3e}
.fac .tri.v{background:#cfeAd6;border-color:#9fd3ae}
.fac .tri.na{background:#eceef2;color:#8a8d94;font-size:11px;font-weight:700}
.fac td.cellV{background:#e3f3e6}
.fac td.cellNa{background:#f4f4f6}
.fac .facLegend{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--steel,#5b5e66);margin:8px 0 0}
.fac .facLegend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-inline-end:5px;border:1px solid #d9dce2}
.fac .facSave{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:14px}
.fac .facSaved{font-size:12.5px;color:#1f7a3e;font-weight:700}
.fac .facErr{color:#b02a37;font-weight:600;font-size:13px;text-align:center;margin:10px 0}
.fac .facMsg{background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.fac .facMsg pre{white-space:pre-wrap;font:inherit;font-size:13px;margin:6px 0 0;line-height:1.55}
.fac .facMsg textarea{width:100%;min-height:200px;font:inherit;font-size:13px;border:1px solid var(--line,#e6e6e9);border-radius:8px;padding:8px;line-height:1.55}
.fac .facSvc td{background:#fafbfc;padding:10px}
.fac .facSvcGrid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;align-items:end;max-width:820px;margin:0 auto}
.fac .facSvcGrid label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;font-weight:700;color:var(--steel,#5b5e66);text-align:start}
.fac .facFloors{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.fac .chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:#eef1f5;font-weight:700;font-size:12.5px}
.fac .chip button{border:0;background:none;cursor:pointer;padding:0;color:#8a8d94;display:flex}
.fac .facEmpty{padding:22px;text-align:center;color:var(--mist,#9a9da5)}
.fac .facToast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#101114;color:#fff;padding:9px 16px;border-radius:10px;font-weight:600;font-size:13px;z-index:900}
@media (max-width:700px){.fac .facSvcGrid{grid-template-columns:1fr 1fr}}
`;

// ----------------------------------------------------------------------------- mail / copy
function openMail({ to, bcc, subject, body }) {
  const q = [];
  if (bcc) q.push("bcc=" + encodeURIComponent(bcc));
  if (subject) q.push("subject=" + encodeURIComponent(subject));
  if (body) q.push("body=" + encodeURIComponent(body.replace(/\n/g, "\r\n")));
  window.location.href = `mailto:${encodeURIComponent(to || "").replace(/%40/g, "@").replace(/%2C/g, ",")}?${q.join("&")}`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    try {
      const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); return true;
    } catch (e2) { return false; }
  }
}

// ----------------------------------------------------------------------------- the module
export function FacilityFile({ projectId, project, projectName, contactsNode, contactsCount, supplierHints, printParts, currentEmail }) {
  const print = useMemo(() => makeFacilityPrint({ projectName, ...(printParts || {}) }), [projectName, printParts]);
  const [data, setData] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);              // chapter key
  const [saveState, setSaveState] = useState("");      // "", "saving", "saved"
  const [toast, setToast] = useState("");
  const dirtyRef = useRef(false);
  const runRef = useRef(0);
  const timerRef = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;
  const openRef = useRef(null);
  openRef.current = open;

  // ---------------------------------------------------------------- load
  useEffect(() => {
    let off = false;
    setData(null); setLoadedFor(null); setErr(""); dirtyRef.current = false;
    (async () => {
      const { data: row, error } = await supabase.from("facility_files").select("data").eq("project_id", projectId).maybeSingle();
      if (off) return;
      if (error) {
        console.warn("[facility] load failed", error);
        setErr(/relation|does not exist|schema cache/i.test(error.message || "")
          ? "טבלת תיק המתקן עדיין לא קיימת ב-Supabase — יש להריץ את facility/supabase/001_facility.sql"
          : "טעינת תיק המתקן נכשלה: " + (error.message || ""));
        return;
      }
      const d = { ...blank(), ...((row && row.data) || {}) };
      if (!Array.isArray(d.floors)) d.floors = floorsFromProject(project);
      console.info("[facility] loaded", projectId, row ? "existing" : "new", { suppliers: d.suppliers.length });
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
    const { error } = await supabase.from("facility_files").upsert(
      { project_id: projectId, data: payload, updated_at: new Date().toISOString(), updated_by: currentEmail || null },
      { onConflict: "project_id" });
    if (run !== runRef.current) return;                // overtaken by a newer save: that one decides
    if (error) {
      console.warn("[facility] save failed", error);
      dirtyRef.current = true;
      setSaveState(""); setErr("השמירה נכשלה: " + (error.message || ""));
      return;
    }
    console.info("[facility] saved", projectId);
    setErr(""); setSaveState("saved");
    setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 2200);
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  // leaving the cube with an edit in hand: save it — only an edit made on purpose, for this project
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

  // ---------------------------------------------------------------- Back button
  useEffect(() => {
    const onPop = () => { if (openRef.current) setOpen(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const goChapter = (k) => { try { window.history.pushState({ awfac: Date.now() }, ""); } catch (e) {} setOpen(k); };
  const goBack = () => { try { window.history.back(); } catch (e) { setOpen(null); } };

  const flash = (t) => { setToast(t); setTimeout(() => setToast(""), 1800); };
  const floors = (data && data.floors) || [];

  if (err && !data) return html`<div className="fac" dir="rtl"><style>${css}</style><p className="facErr">${err}</p></div>`;
  if (!data) return html`<div className="fac" dir="rtl"><style>${css}</style><p className="facEmpty">טוען…</p></div>`;

  const ch = open ? CH[open] : null;
  const saveRow = html`<div className="facSave">
    <button type="button" className="facBtn primary" onClick=${() => { dirtyRef.current = true; saveNow(); }}>
      <${Save} size=${15} strokeWidth=${2.2} /> שמירה</button>
    ${saveState === "saving" && html`<span className="facSaved" style=${{ color: "#5b5e66" }}>שומר…</span>`}
    ${saveState === "saved" && html`<span className="facSaved">נשמר ✓</span>`}
  </div>`;

  // ---------------------------------------------------------------- the nine buttons
  if (!ch) {
    const tail = CHAPTERS.length % 3;
    return html`<div className="fac" dir="rtl"><style>${css}</style>
      ${err && html`<p className="facErr">${err}</p>`}
      <div className=${`cardGrid ${tail === 1 ? "tail1" : tail === 2 ? "tail2" : ""}`.trim()}>
        ${CHAPTERS.map((c) => {
          const p = progressOf(data, c, floors, contactsCount);
          const all = p.total > 0 && p.done === p.total;
          return html`<button key=${c.k} type="button" className=${`dashCard ${all ? "facAllDone" : ""}`} onClick=${() => goChapter(c.k)}>
            <div className="cardIcon" style=${{ color: c.color }}><${c.icon} size=${20} strokeWidth=${1.7} /></div>
            <div style=${{ width: "100%" }}>
              <p className="cardTitle">${c.n}. ${c.he}</p>
              ${p.total > 0 && html`<${F}><div className="facProg"><i style=${{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></div>
                <p className="facCount">${p.done}/${p.total}</p><//>`}
              ${p.label && html`<p className="facCount">${p.label}</p>`}
            </div>
          </button>`;
        })}
      </div>
    </div>`;
  }

  const bar = (extra) => html`<div className="facBar">
    <span className="facTitle"><${ch.icon} size=${18} strokeWidth=${1.9} color=${ch.color} /> ${ch.n}. ${ch.he}</span>
    ${extra}
    <button type="button" className="facBtn" onClick=${goBack}>חזרה לתיק מתקן</button>
  </div>`;

  let body = null;
  if (ch.kind === "contacts") body = html`<${F}>${bar(null)}${contactsNode}<//>`;
  else if (ch.kind === "check") body = html`<${F}><${CheckChapter} ch=${ch} data=${data} edit=${edit} bar=${bar} projectName=${projectName} flash=${flash} />${saveRow}<//>`;
  else if (ch.kind === "suppliers") body = html`<${F}><${SupplierChapter} data=${data} edit=${edit} bar=${bar} projectName=${projectName} hints=${supplierHints} print=${print} flash=${flash} />${saveRow}<//>`;
  else if (ch.kind === "asmade") body = html`<${F}><${AsMadeChapter} ch=${ch} data=${data} edit=${edit} bar=${bar} floors=${floors} />${saveRow}<//>`;

  return html`<div className="fac" dir="rtl"><style>${css}</style>
    ${err && html`<p className="facErr">${err}</p>`}
    ${body}
    ${toast && html`<div className="facToast">${toast}</div>`}
  </div>`;
}

// ----------------------------------------------------------------------------- shared: the message box
function MessageBox({ text, onSave, subject, bcc, flash, editable }) {
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  useEffect(() => { if (!editing) setDraft(text); }, [text, editing]);
  return html`<div className="facMsg">
    <div style=${{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="facBtn" onClick=${() => setShow((s) => !s)}>
        ${show ? html`<${ChevronUp} size=${15} />` : html`<${ChevronDown} size=${15} />`} נוסח ההודעה</button>
      <button type="button" className="facBtn" onClick=${async () => flash((await copyText(text)) ? "ההודעה הועתקה" : "ההעתקה נכשלה")}>
        <${Copy} size=${15} /> העתקה</button>
      <button type="button" className="facBtn" onClick=${() => openMail({ bcc, subject, body: text })}>
        <${Mail} size=${15} /> פתיחת מייל</button>
      ${editable && show && !editing && html`<button type="button" className="facBtn" onClick=${() => setEditing(true)}><${Pencil} size=${14} /> עריכת נוסח</button>`}
    </div>
    ${show && !editing && html`<pre dir="rtl">${text}</pre>`}
    ${show && editing && html`<div style=${{ marginTop: 8 }}>
      <textarea dir="rtl" value=${draft} onChange=${(e) => setDraft(e.target.value)} />
      <div style=${{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" className="facBtn primary" onClick=${() => { onSave(draft); setEditing(false); }}>שמירת נוסח</button>
        <button type="button" className="facBtn" onClick=${() => { setDraft(text); setEditing(false); }}>ביטול</button>
      </div></div>`}
  </div>`;
}

// ----------------------------------------------------------------------------- chapters 2, 4–8: checklist
function CheckChapter({ ch, data, edit, bar, projectName, flash }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const items = chapterItems(data, ch);
  const st = data.items || {};
  const set = (id, patch) => edit((d) => {
    d.items = d.items || {};
    const cur = d.items[id] || {};
    const next = { ...cur, ...patch };
    if (patch.na) next.done = false;               // not relevant: no tick
    d.items[id] = next;
    return d;
  });
  const add = () => {
    const l = label.trim();
    if (!l) return;
    edit((d) => { d.custom = d.custom || {}; d.custom[ch.k] = [...(d.custom[ch.k] || []), { id: `${ch.k}-${uid()}`, label: l }]; return d; });
    setLabel(""); setAdding(false);
  };
  const remove = (id) => {
    if (!confirm("להסיר את השורה?")) return;
    edit((d) => { d.custom[ch.k] = (d.custom[ch.k] || []).filter((x) => x.id !== id); if (d.items) delete d.items[id]; return d; });
  };
  const pending = items.filter((it) => !(st[it.id] || {}).na && !(st[it.id] || {}).done);
  const msg = ch.mail ? ((data.msgs || {})[ch.k] ?? MSG_DEFAULT[ch.k] ?? "") : null;
  const subject = `${projectName || ""} – תיק מתקן – ${ch.he}`.replace(/^ – /, "");

  return html`<${F}>
    ${bar(html`${ch.add && html`<button type="button" className="facBtn" onClick=${() => setAdding((a) => !a)}><${Plus} size=${15} strokeWidth=${2.4} /> ${ch.add}</button>`}`)}
    ${ch.mail && html`<${MessageBox} text=${msg} editable=${true} subject=${subject} flash=${flash}
      onSave=${(t) => edit((d) => { d.msgs = d.msgs || {}; d.msgs[ch.k] = t; return d; })} />`}
    ${adding && html`<div className="facBar">
      <input className="facIn" style=${{ maxWidth: 420 }} autoFocus placeholder="שם הסעיף" value=${label}
        onChange=${(e) => setLabel(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }} />
      <button type="button" className="facBtn primary" onClick=${add}>הוספה</button>
      <button type="button" className="facBtn" onClick=${() => setAdding(false)}>ביטול</button>
    </div>`}
    <div className="facWin"><table>
      <thead><tr><th>#</th><th style=${{ textAlign: "start" }}>סעיף</th><th>בוצע V</th><th>לא רלוונטי</th><th>הערה</th><th></th></tr></thead>
      <tbody>${items.map((it, i) => {
        const s = st[it.id] || {};
        const cls = s.na ? "na" : s.done ? "ok" : "";
        return html`<tr key=${it.id} className=${cls}>
          <td className="num">${ch.n}.${i + 1}</td>
          <td className="lbl">${it.label}</td>
          <td><input type="checkbox" className="doneBox" checked=${!!s.done} disabled=${!!s.na} onChange=${(e) => set(it.id, { done: e.target.checked })} /></td>
          <td><input type="checkbox" className="naBox" checked=${!!s.na} onChange=${(e) => set(it.id, { na: e.target.checked })} /></td>
          <td style=${{ minWidth: 180 }}><input className="facIn" value=${s.note || ""} placeholder=${s.na ? "סיבה" : ""} onChange=${(e) => set(it.id, { note: e.target.value })} /></td>
          <td style=${{ width: 40 }}>${it.custom && html`<button type="button" className="facBtn icon" title="הסרה" onClick=${() => remove(it.id)}><${Trash2} size=${14} color="#b02a37" /></button>`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
    <div className="facLegend"><span><i style=${{ background: "#e3f3e6" }} />בוצע</span><span><i style=${{ background: "#f4f4f6" }} />לא רלוונטי — לא נספר</span>
      <span>נותרו ${pending.length}</span></div><//>`;
}

// ----------------------------------------------------------------------------- chapter 3: suppliers
const NEXT = { "": "v", v: "na", na: "" };
function SupplierChapter({ data, edit, bar, projectName, hints, print, flash }) {
  const [openSvc, setOpenSvc] = useState(null);
  const sups = data.suppliers || [];
  const patch = (id, fn) => edit((d) => { d.suppliers = (d.suppliers || []).map((s) => (s.id === id ? fn({ ...s }) : s)); return d; });
  const addSup = () => edit((d) => { d.suppliers = [...(d.suppliers || []), { id: uid(), name: "", product: "", email: "", cells: {}, service: {} }]; return d; });
  const remove = (s) => {
    if (!confirm(`להסיר את ${s.name || "הספק"}?`)) return;
    edit((d) => { d.suppliers = d.suppliers.filter((x) => x.id !== s.id); return d; });
  };
  const subject = `${projectName || ""} – תיק מתקן – אישורים, אחריות והוראות תחזוקה`.replace(/^ – /, "");
  const openEmails = sups.filter((s) => supRowState(s) === "open" && String(s.email || "").includes("@")).map((s) => s.email.trim());
  const listId = "facSupHints";

  return html`<${F}>
    ${bar(html`<${F}>
      <button type="button" className="facBtn" onClick=${addSup}><${Plus} size=${15} strokeWidth=${2.4} /> ספק</button>
      <button type="button" className="facBtn icon" title=${openEmails.length ? `מייל לכל הספקים שעוד חסר אצלם (${openEmails.length})` : "פתיחת מייל עם הנוסח"}
        onClick=${() => openMail({ bcc: openEmails.join(","), subject, body: MSG_921 })}><${Mail} size=${16} /></button><//>`)}
    <${MessageBox} text=${MSG_921} editable=${false} subject=${subject} bcc=${openEmails.join(",")} flash=${flash} />
    <datalist id=${listId}>${(hints || []).map((h) => html`<option key=${h} value=${h} />`)}</datalist>
    <div className="facWin"><table>
      <thead><tr><th>#</th><th>ספק</th><th>מוצר / עבודה</th><th>מייל</th>
        ${SUP_COLS.map(([k, l]) => html`<th key=${k}>${l}</th>`)}<th></th></tr></thead>
      <tbody>
        ${sups.length === 0 && html`<tr><td colSpan=${6 + SUP_COLS.length} className="facEmpty">עדיין לא נוספו ספקים — לחצי על "+ ספק"</td></tr>`}
        ${sups.map((s, i) => {
          const rs = supRowState(s);
          const svc = s.service || {};
          return html`<${React.Fragment} key=${s.id}>
            <tr className=${rs === "done" ? "ok" : rs === "na" ? "na" : ""}>
              <td className="num">3.${i + 1}</td>
              <td><input className="facIn" list=${listId} value=${s.name || ""} placeholder="שם הספק" onChange=${(e) => patch(s.id, (x) => ({ ...x, name: e.target.value }))} /></td>
              <td><input className="facIn" value=${s.product || ""} onChange=${(e) => patch(s.id, (x) => ({ ...x, product: e.target.value }))} /></td>
              <td><input className="facIn" dir="ltr" type="email" value=${s.email || ""} onChange=${(e) => patch(s.id, (x) => ({ ...x, email: e.target.value }))} /></td>
              ${SUP_COLS.map(([k]) => {
                const v = (s.cells || {})[k] || "";
                return html`<td key=${k} className=${v === "v" ? "cellV" : v === "na" ? "cellNa" : ""}>
                  <div style=${{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                    <button type="button" className=${`tri ${v}`} title="לחיצה: V ← לא רלוונטי ← ריק"
                      onClick=${() => patch(s.id, (x) => ({ ...x, cells: { ...(x.cells || {}), [k]: NEXT[v] } }))}>${v === "v" ? "✓" : v === "na" ? "ל״ר" : ""}</button>
                    ${k === "service" && html`<button type="button" className="facBtn icon" title="פרטי מחלקת בדק"
                      onClick=${() => setOpenSvc(openSvc === s.id ? null : s.id)}><${Pencil} size=${13} /></button>`}
                  </div></td>`;
              })}
              <td style=${{ whiteSpace: "nowrap" }}>
                ${String(s.email || "").includes("@") && html`<button type="button" className="facBtn icon" title="מייל לספק"
                  onClick=${() => openMail({ to: s.email.trim(), subject, body: MSG_921 })}><${Mail} size=${14} /></button>`}
                <button type="button" className="facBtn icon" title="הסרה" onClick=${() => remove(s)}><${Trash2} size=${14} color="#b02a37" /></button>
              </td>
            </tr>
            ${openSvc === s.id && html`<tr className="facSvc"><td colSpan=${6 + SUP_COLS.length}>
              <div style=${{ fontWeight: 800, marginBottom: 8 }}>פרטי מחלקת הבדק והשירות — ${s.name || "ספק"}</div>
              <div className="facSvcGrid">
                ${[["name", "שם איש קשר"], ["phone", "מספר טלפון"], ["mobile", "מספר נייד"], ["email", "כתובת מייל"]].map(([k, l]) => html`
                  <label key=${k}>${l}<input className="facIn" dir=${k === "name" ? "rtl" : "ltr"} value=${svc[k] || ""}
                    onChange=${(e) => patch(s.id, (x) => ({ ...x, service: { ...(x.service || {}), [k]: e.target.value } }))} /></label>`)}
              </div>
              <div style=${{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button type="button" className="facBtn" onClick=${() => print && print.serviceSheet([s])}><${Printer} size=${15} /> PDF לספק הזה</button>
                <button type="button" className="facBtn" onClick=${() => setOpenSvc(null)}><${X} size=${15} /> סגירה</button>
              </div>
            </td></tr>`}
          <//>`;
        })}
      </tbody>
    </table></div>
    <div className="facLegend">
      <span><i style=${{ background: "#e3f3e6" }} />V — התקבל</span>
      <span><i style=${{ background: "#f4f4f6" }} />לא רלוונטי</span>
      <span>לחיצה על משבצת: V ← ל״ר (לא רלוונטי) ← ריק</span>
      ${sups.some((s) => Object.values(s.service || {}).some(Boolean)) && html`<button type="button" className="facBtn" style=${{ padding: "3px 10px" }}
        onClick=${() => print && print.serviceSheet(sups.filter((s) => Object.values(s.service || {}).some(Boolean)))}><${Printer} size=${14} /> PDF פרטי בדק — כל הספקים</button>`}
    </div><//>`;
}

// ----------------------------------------------------------------------------- chapter 9: AS MADE per floor
function AsMadeChapter({ ch, data, edit, bar, floors }) {
  const [fl, setFl] = useState("");
  const am = data.asMade || {};
  const setCell = (id, f, val) => edit((d) => {
    d.asMade = d.asMade || {};
    const cur = d.asMade[id] || {};
    d.asMade[id] = { ...cur, floors: { ...(cur.floors || {}), [f]: val } };
    return d;
  });
  const setNa = (id, val) => edit((d) => { d.asMade = d.asMade || {}; d.asMade[id] = { ...(d.asMade[id] || {}), na: val }; return d; });
  const addFloor = () => {
    const v = fl.trim();
    if (!v || floors.includes(v)) { setFl(""); return; }
    edit((d) => { d.floors = [...(d.floors || []), v]; return d; });
    setFl("");
  };
  const removeFloor = (f) => edit((d) => { d.floors = (d.floors || []).filter((x) => x !== f); return d; });

  return html`<${F}>
    ${bar(html`<div className="facFloors"><span style=${{ fontWeight: 700, fontSize: 13 }}>קומות:</span>
      ${floors.map((f) => html`<span key=${f} className="chip">${f}<button type="button" title="הסרת קומה" onClick=${() => removeFloor(f)}><${X} size=${12} /></button></span>`)}
      <input className="facIn" style=${{ width: 70, minWidth: 0 }} placeholder="קומה" value=${fl}
        onChange=${(e) => setFl(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") addFloor(); }} />
      <button type="button" className="facBtn icon" title="הוספת קומה" onClick=${addFloor}><${Plus} size=${14} strokeWidth=${2.4} /></button>
    </div>`)}
    ${floors.length === 0 && html`<p className="facEmpty">אין קומות לפרויקט — הוסיפי קומות למעלה, ולכל אחת יופיע סימון.</p>`}
    ${floors.length > 0 && html`<${F}><div className="facWin"><table>
      <thead><tr><th>#</th><th style=${{ textAlign: "start" }}>סוג תוכנית</th>
        ${floors.map((f) => html`<th key=${f}>קומה ${f}</th>`)}<th>לא רלוונטי</th></tr></thead>
      <tbody>${(ch.items || []).map(([id, label], i) => {
        const s = am[id] || {};
        const all = floors.every((f) => (s.floors || {})[f]);
        return html`<tr key=${id} className=${s.na ? "na" : all ? "ok" : ""}>
          <td className="num">9.${i + 1}</td>
          <td className="lbl">${label}</td>
          ${floors.map((f) => {
            const on = !!(s.floors || {})[f];
            return html`<td key=${f} className=${!s.na && on ? "cellV" : ""}>
              <input type="checkbox" className="doneBox" checked=${on} disabled=${!!s.na} onChange=${(e) => setCell(id, f, e.target.checked)} /></td>`;
          })}
          <td><input type="checkbox" className="naBox" checked=${!!s.na} onChange=${(e) => setNa(id, e.target.checked)} /></td>
        </tr>`;
      })}</tbody>
    </table></div>
    <div className="facLegend"><span><i style=${{ background: "#e3f3e6" }} />הקומה סומנה — השורה ירוקה כשכל הקומות סומנו</span><span><i style=${{ background: "#f4f4f6" }} />לא רלוונטי — לא נספר</span></div><//>`}<//>`;
}

// ----------------------------------------------------------------------------- service-department sheet (PDF)
// The display instructions for this PDF are still to come from her; until then it is
// the house paper (same shell as the contacts sheet): logos, title, one table.
export function makeFacilityPrint({ projectName, brand, accent, paginateJs, whenPaged }) {
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    serviceSheet(list) {
      const b = brand || {};
      const acc = accent || "#14265e";
      const rows = (list || []).map((s) => {
        const v = s.service || {};
        const tel = (x) => (x ? `<a href="tel:${esc(String(x).replace(/[^0-9+]/g, ""))}">${esc(x)}</a>` : "");
        return `<tr><td>${esc(s.name)}</td><td>${esc(s.product)}</td><td>${esc(v.name)}</td><td>${tel(v.phone)}</td><td>${tel(v.mobile)}</td><td>${v.email ? `<a href="mailto:${esc(v.email)}">${esc(v.email)}</a>` : ""}</td></tr>`;
      }).join("");
      const logo = b.logoUrl ? `<img src="${b.logoUrl}" alt="logo">` : "<span></span>";
      const clientLogo = b.clientLogoUrl ? `<img class="clientLogo" src="${b.clientLogoUrl}" alt="logo">` : "<span></span>";
      const footBlock = b.footerImg ? `<div class="footImg" id="footimg"><img src="${b.footerImg}" alt="footer"></div>` : "";
      const title = "פרטי מחלקת בדק ושירות";
      const doc = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(`${projectName || ""} - ${title}`)}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Inter:wght@500;600;700&display=swap');
${printSheetCss({ landscape: false, accent: acc })}
body { font-family: 'Assistant', 'Inter', Arial, sans-serif; color: #17181c; direction: rtl; }
.hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; border-bottom: 2.5px solid #d5d9df; padding-bottom: 10px; margin-bottom: 14px; }
.hdr img { max-height: 44px; max-width: 140px; object-fit: contain; justify-self: start; }
.hdr img.clientLogo { justify-self: end; }
.ttlWrap { grid-column: 2; text-align: center; }
.ttlWrap .ttl { font-size: 19px; font-weight: 800; color: ${acc}; }
.ttlWrap .sub { font-size: 11px; font-weight: 600; color: ${acc}; margin-top: 3px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td { font-size: 9px; padding: 5px 4px; border-bottom: 1px solid #f0f0f2; text-align: center; vertical-align: middle; word-break: break-word; }
tr.hd td { background: ${acc}; color: #fff; font-weight: 800; }
a { color: #17181c; text-decoration: none; }
</style></head><body><div id="src">
<div class="hdr">${logo}<div class="ttlWrap"><div class="ttl">${esc(projectName || "")}</div><div class="sub">${esc(title)}</div></div>${clientLogo}</div>
<table><colgroup><col style="width:18%"><col style="width:18%"><col style="width:17%"><col style="width:14%"><col style="width:14%"><col style="width:19%"></colgroup><tbody>
<tr class="hd"><td>ספק</td><td>מוצר / עבודה</td><td>שם איש קשר</td><td>טלפון</td><td>נייד</td><td>מייל</td></tr>${rows}</tbody></table>
${footBlock}</div><div id="pages"></div>${paginateJs ? paginateJs(printedStampText("he")) : ""}</body></html>`;
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.open(); w.document.write(doc); w.document.close(); w.focus();
      if (whenPaged) whenPaged(w, 300); else setTimeout(() => { try { w.print(); } catch (e) {} }, 600);
    },
  };
}
