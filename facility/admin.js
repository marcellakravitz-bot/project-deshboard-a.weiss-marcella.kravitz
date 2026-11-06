// =============================================================================
//  facility/admin.js — תיק מתקן (Facility File). A. Weiss dashboard
//  facility build 1 · 28.10.2026 (site: build 224)
//
//  The dashboard loads this file when the administrator opens the cube that
//  used to be "Contacts". Contacts now live INSIDE it, as chapter 1 — the
//  dashboard hands the existing contacts table in as `contactsNode`, unchanged.
//
//  The chapters, each a square button (her layout, 28.10.26; 06.11.26):
//    אנשי קשר                       the project's contacts editor (consultants,
//                                    subcontractors, suppliers…)
//    רשימת חומרי גמר                products picked from LLI; per product the
//                                    maintenance instructions, warranty, ת"י 755
//                                    and the service department (kept in the
//                                    suppliers' library); suppliers join contacts
//    אישורי מכון התקנים             checklist + add (921 is one of its lines)
//    אישורי מתכננים                 checklist + add + e-mail
//    אישורי קבלנים/מבצעים והצהרות   checklist + add + e-mail
//    אישור כבאות לאכלוס             checklist
//    תיקי מתקן – קבלני מערכות       checklist + add
//    תוכניות AS MADE                one tick per floor
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
  Plus, Mail, Copy, Trash2, Printer, Pencil, Save, ChevronDown, ChevronUp, X, ListPlus, Search, ArrowRight,
  FileText, FileSpreadsheet, ImagePlus,
} from "lucide-react";
import { supabase, printSheetCss, printedStampText, supLibLoad, supLibFind, supLibSave, supLibHasService, supLibNorm, PrintLangAsk, imgAsk, imgPickProps, imgLibAdd } from "../sign.js";

const html = htm.bind(React.createElement);
const F = React.Fragment;   // a template with more than one root returns an array without keys
export const FACILITY_BUILD = "facility build 4 · 06.11.2026";
if (typeof console !== "undefined") console.info(FACILITY_BUILD);

// ----------------------------------------------------------------------------- the chapters
// 06.11.26 — no numbers on the folders; "ת"י 921 + אחריות ותחזוקה" is gone:
// its four documents are columns of the finishes list (picked from LLI), and
// 921 is a line of the standards institute's approvals.
const CHAPTERS = [
  { k: "contacts", he: "אנשי קשר", icon: Phone, color: "#0EA5E9", kind: "contacts" },
  { k: "finishes", he: "רשימת חומרי גמר", icon: Layers, color: "#8B5E3C", kind: "finishes" },
  { k: "standards", he: "אישורי מכון התקנים", icon: BadgeCheck, color: "#2563EB", kind: "check", add: "הוספת אישור מכון תקנים", items: [
    ["si-921", "921 – תגובה בשריפה של חומרי בנייה"],
    ["si-931", "931 – אטומי אש"], ["si-1001", "1001 – מיזוג אוויר"], ["si-1001-7", "1001-7 – מיזוג אוויר"],
    ["si-1212", "1212 – אישור התקנה"], ["si-1220", "1220 – גילוי אש"], ["si-1596", "1596 – ספרינקלרים"],
    ["si-1597", "1597 – כיבוי בגז"], ["si-2206", "2206 – גלגלונים"], ["si-integ", "אינטגרציה"],
    ["si-elec-run", "בדיקות חשמל להרצת מערכות"], ["si-ceil-load", "בדיקת העמסת תקרות"], ["si-hvac-water", "בדיקת מי מיזוג"],
  ] },
  { k: "designers", he: "אישורי מתכננים", icon: PenTool, color: "#7C3AED", kind: "check", add: "הוספת יועץ / מתכנן", mail: true, items: [
    ["ds-arch", "אדריכל מבצע"], ["ds-plumb", "יועץ אינסטלציה"], ["ds-acou", "יועץ אקוסטיקה"], ["ds-fire", "יועץ בטיחות אש"],
    ["ds-elec", "יועץ חשמל"], ["ds-hvac", "יועץ מיזוג אוויר"], ["ds-access", "יועץ נגישות"],
    ["ds-struct", "יועץ קונסטרוקציה ומדרגות"], ["ds-sustain", "יועץ קיימות"], ["ds-light", "יועץ תאורה"],
  ] },
  { k: "contractors", he: "אישורי קבלנים/מבצעים והצהרות", icon: HardHat, color: "#E8B10A", kind: "check", add: "הוספת קבלן / מבצע", mail: true, items: [
    ["ct-main", "קבלן ראשי – א. וייס"], ["ct-water", "קבלן מערכות מים וביוב"], ["ct-elec", "קבלן חשמל, בודק חשמל ולוחות חשמל"],
    ["ct-hvac", "קבלן מיזוג אוויר"], ["ct-curtain", "קבלן וילונות אש"], ["ct-firestop", "מבצע אטומי אש"],
  ] },
  { k: "fire", he: "אישור כבאות לאכלוס", icon: Flame, color: "#C0392B", kind: "check", items: [
    ["fd-safety", "אישור יועץ בטיחות"], ["fd-ops", "משטר הפעלות"],
  ] },
  { k: "systems", he: "תיקי מתקן – קבלני מערכות", icon: FolderOpen, color: "#EA7317", kind: "check", add: "הוספת קבלן מערכות", items: [
    ["sy-plumb", "תיק מתקן קבלן אינסטלציה"], ["sy-elec", "תיק מתקן קבלן חשמל"], ["sy-hvac", "תיק מתקן קבלן מיזוג אוויר"],
  ] },
  { k: "asmade", he: "תוכניות AS MADE", icon: MapIcon, color: "#0E7490", kind: "asmade", items: [
    ["am-build", "תוכניות בינוי"], ["am-fin", "תוכניות גמרים"], ["am-layout", "תוכניות העמדה"],
    ["am-ftc", "תוכניות FTC"], ["am-floor", "תוכניות ריצוף"], ["am-ceil", "תוכניות תקרה"],
  ] },
];
const CH = Object.fromEntries(CHAPTERS.map((c) => [c.k, c]));

// The finishes list — the four documents asked for every product (her order, 06.11.26).
const FIN_COLS = [["maint", "הוראות תחזוקה ואחזקה"], ["warranty", "כתב אחריות"], ["s755", "ת\"י 755"], ["service", "פרטי מחלקת בדק"]];

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

const blank = () => ({ v: 2, items: {}, custom: {}, finishes: [], floors: null, asMade: {}, msgs: {} });
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
// A cell of the finishes list: what she ticked, or — for the service
// department — V on its own when the supplier's library entry has the details.
function finCell(row, k, lib) {
  const v = (row.cells || {})[k] || "";
  if (v) return v;
  if (k === "service" && supLibHasService(supLibFind(lib, row.supplier))) return "auto";
  return "";
}
function finRowState(row, lib) {
  const cells = FIN_COLS.map(([k]) => finCell(row, k, lib));
  if (cells.every((c) => c === "na")) return "na";
  if (cells.every((c) => c === "v" || c === "auto" || c === "na")) return "done";
  return "open";
}
function progressOf(data, ch, floors, lib) {
  if (ch.kind === "contacts") return { label: "", done: 0, total: 0 };
  if (ch.kind === "finishes") {
    const rows = (data.finishes || []).map((r) => finRowState(r, lib)).filter((s) => s !== "na");
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
.fac .facFrame{background:var(--surface,#fff);border:1px solid var(--line,#e6e6e9);border-radius:14px;padding:14px 16px;width:100%;min-height:620px;box-sizing:border-box}
.fac .facFrame>.facBar:first-child{border:0;border-bottom:1px solid var(--line,#e6e6e9);border-radius:0;padding:0 0 10px;margin-bottom:12px}
.fac .facFrame .panel{box-shadow:none;border:0;padding:0;margin:0;width:100%;max-width:none;background:transparent}
.fac .facFrame .contactsAdminBar{margin-top:0}
.fac .facBack{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:#8a8d94;font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:2px 4px;margin:0 0 6px;border-radius:6px}
.fac .facBack:hover{color:#3f434b;background:#f2f3f6}
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
.fac .facScrim{position:fixed;inset:0;background:rgba(16,17,20,.32);z-index:880;display:flex;align-items:center;justify-content:center;padding:16px}
.fac .facMailWin{background:#fff;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.22);width:min(560px,100%);max-height:86vh;overflow:auto;padding:14px 16px;position:relative}
.fac .facMailWin h3{margin:0 0 12px;text-align:center;font-size:16px;font-weight:800}
.fac .facMailWin .x{position:absolute;top:10px;inset-inline-end:10px;border:0;background:none;cursor:pointer;color:#8a8d94;display:flex}
.fac .facMailOpts{display:flex;flex-direction:column;gap:8px;max-width:300px;margin:0 auto}
.fac .facMailOpts .facBtn{justify-content:flex-start;padding:9px 14px;font-size:14px}
.fac .facMailOpts .facBtn.on{border-color:var(--accent,#17181c);background:#f4f6f9}
.fac .facMailWin pre{white-space:pre-wrap;font:inherit;font-size:13px;line-height:1.55;background:#fafbfc;border:1px solid var(--line,#e6e6e9);border-radius:10px;padding:10px;margin:12px 0 0}
.fac .facMailWin textarea{width:100%;min-height:240px;font:inherit;font-size:13px;border:1px solid var(--line,#e6e6e9);border-radius:10px;padding:10px;line-height:1.55;margin-top:12px;box-sizing:border-box}
.fac .facSvc td{background:#fafbfc;padding:10px}
.fac .facSvcGrid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;align-items:end;max-width:820px;margin:0 auto}
.fac .facSvcGrid label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;font-weight:700;color:var(--steel,#5b5e66);text-align:start}
.fac .facFloors{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.fac .chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:#eef1f5;font-weight:700;font-size:12.5px}
.fac .chip button{border:0;background:none;cursor:pointer;padding:0;color:#8a8d94;display:flex}
.fac .facEmpty{padding:22px;text-align:center;color:var(--mist,#9a9da5)}
.fac .facToast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#101114;color:#fff;padding:9px 16px;border-radius:10px;font-weight:600;font-size:13px;z-index:900}
.fac .facPick{background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.fac .facPickBar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.fac .facPickSearch{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#e6e6e9);border-radius:8px;padding:4px 8px}
.fac .facPickSearch input{border:0;outline:0;font:inherit;font-size:13px;min-width:160px}
.fac .facPickAll{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:13px;cursor:pointer;margin-inline-start:auto}
.fac .facPickList{max-height:340px;overflow:auto;border:1px solid var(--line,#e6e6e9);border-radius:10px}
.fac .facPickRow{display:grid;grid-template-columns:22px 130px 90px 1fr 150px 52px;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid #f0f0f2;cursor:pointer;font-size:13px}
.fac .facPickRow:hover{background:#f5f7fb}
.fac .facPickRow .pic,.fac .finPic{width:46px;height:38px;border-radius:6px;border:1px solid #e3e5ea;background:#f6f7f9;display:flex;align-items:center;justify-content:center;overflow:hidden;margin:0 auto}
.fac .facPickRow .pic img,.fac .finPic img{width:100%;height:100%;object-fit:contain;background:#fff}
.fac .finPic{cursor:pointer;color:#a6a9b0;position:relative}
.fac .finPic:hover{border-color:#8a8d94}
.fac .finPicX{position:absolute;top:-1px;inset-inline-end:-1px;border:0;background:#fff;border-radius:0 6px 0 6px;padding:1px;cursor:pointer;display:none;color:#b02a37}
.fac .finPic:hover .finPicX{display:flex}
.fac td.finNote{min-width:150px}
.fac table.finTbl th{white-space:normal;line-height:1.2;padding:7px 5px;font-size:12px}
.fac table.finTbl td{padding:5px 4px}
.fac table.finTbl .facIn{min-width:0;padding:5px 6px}
.fac table.finTbl td.lbl{min-width:170px}
.fac .facPickRow .d{font-weight:600}.fac .facPickRow .c,.fac .facPickRow .s{color:#5b5e66;font-size:12.5px}
@media (max-width:700px){.fac .facSvcGrid{grid-template-columns:1fr 1fr}.fac .facPickRow{grid-template-columns:22px 1fr 52px}.fac .facPickRow .c,.fac .facPickRow .m,.fac .facPickRow .s{display:none}}
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
export function FacilityFile({ projectId, project, projectName, contactsNode, contactsExportNode, printParts, currentEmail, lliItems, contacts, catalog, onAddContacts, boardExport }) {
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
  // The suppliers' library (shared by every project): the service departments.
  const [lib, setLib] = useState([]);
  const reloadLib = async (force) => { try { setLib((await supLibLoad(force)).slice()); } catch (e) { console.warn("[facility] supplier library", e); } };
  useEffect(() => { reloadLib(false); }, []);

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
      if (!Array.isArray(d.finishes)) d.finishes = [];
      console.info("[facility] loaded", projectId, row ? "existing" : "new", { finishes: d.finishes.length });
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
          const p = progressOf(data, c, floors, lib);
          const all = p.total > 0 && p.done === p.total;
          return html`<button key=${c.k} type="button" className=${`dashCard ${all ? "facAllDone" : ""}`} onClick=${() => goChapter(c.k)}>
            <div className="cardIcon" style=${{ color: c.color }}><${c.icon} size=${20} strokeWidth=${1.7} /></div>
            <div style=${{ width: "100%" }}>
              <p className="cardTitle">${c.he}</p>
              ${p.total > 0 && html`<${F}><div className="facProg"><i style=${{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></div>
                <p className="facCount">${p.done}/${p.total}</p><//>`}
              ${p.label && html`<p className="facCount">${p.label}</p>`}
            </div>
          </button>`;
        })}
      </div>
    </div>`;
  }

  // 06.11.26 — the way back is a small grey arrow at the top, on the right;
  // the bar keeps the chapter's own tools.
  const bar = (extra) => html`<div className="facBar">
      <span className="facTitle"><${ch.icon} size=${18} strokeWidth=${1.9} color=${ch.color} /> ${ch.he}</span>
      ${extra}
    </div>`;

  let body = null;
  if (ch.kind === "contacts") body = html`<${F}>${bar(contactsExportNode || null)}${contactsNode}<//>`;
  else if (ch.kind === "check") body = html`<${F}><${CheckChapter} ch=${ch} data=${data} edit=${edit} bar=${bar} projectName=${projectName} flash=${flash} />${saveRow}<//>`;
  else if (ch.kind === "finishes") body = html`<${F}><${FinishesChapter} data=${data} edit=${edit} bar=${bar} projectName=${projectName} print=${print} flash=${flash}
    lliItems=${lliItems || []} contacts=${contacts || []} catalog=${catalog || {}} onAddContacts=${onAddContacts} lib=${lib} reloadLib=${reloadLib}
    projectId=${projectId} boardExport=${boardExport} />${saveRow}<//>`;
  else if (ch.kind === "asmade") body = html`<${F}><${AsMadeChapter} ch=${ch} data=${data} edit=${edit} bar=${bar} floors=${floors} />${saveRow}<//>`;

  // 06.11.26 — every chapter sits in the same white frame, the size of the
  // contacts chapter's, whichever folder is open.
  return html`<div className="fac" dir="rtl"><style>${css}</style>
    ${err && html`<p className="facErr">${err}</p>`}
    <button type="button" className="facBack" onClick=${goBack} title="חזרה לתיק מתקן"><${ArrowRight} size=${15} strokeWidth=${2.2} /> חזרה</button>
    <div className="facFrame">${body}</div>
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

// 06.11.26 — the envelope of the finishes list: one window, "נוסח ההודעה",
// four choices one under the other — view, edit, copy, send.
function MailMenu({ text, onSave, subject, bcc, flash, onClose }) {
  const [mode, setMode] = useState("");          // "", "view", "edit"
  const [draft, setDraft] = useState(text);
  return html`<div className="facScrim" onClick=${onClose}>
    <div className="facMailWin" dir="rtl" onClick=${(e) => e.stopPropagation()}>
      <button type="button" className="x" title="סגירה" onClick=${onClose}><${X} size=${17} /></button>
      <h3>נוסח ההודעה</h3>
      <div className="facMailOpts">
        <button type="button" className=${`facBtn ${mode === "view" ? "on" : ""}`} onClick=${() => setMode(mode === "view" ? "" : "view")}><${FileText} size=${16} /> 1. צפייה</button>
        <button type="button" className=${`facBtn ${mode === "edit" ? "on" : ""}`} onClick=${() => { setDraft(text); setMode(mode === "edit" ? "" : "edit"); }}><${Pencil} size=${15} /> 2. עריכה</button>
        <button type="button" className="facBtn" onClick=${async () => flash((await copyText(text)) ? "ההודעה הועתקה" : "ההעתקה נכשלה")}><${Copy} size=${15} /> 3. העתקה</button>
        <button type="button" className="facBtn" title=${bcc ? "מייל לכל הספקים שעוד חסר אצלם (בעותק מוסתר)" : "פתיחת מייל עם הנוסח"}
          onClick=${() => openMail({ bcc, subject, body: text })}><${Mail} size=${15} /> 4. שליחה</button>
      </div>
      ${mode === "view" && html`<pre>${text}</pre>`}
      ${mode === "edit" && html`<div>
        <textarea value=${draft} onChange=${(e) => setDraft(e.target.value)} />
        <div style=${{ display: "flex", gap: 8, marginTop: 8, justifyContent: "center" }}>
          <button type="button" className="facBtn primary" onClick=${() => { onSave(draft); setMode("view"); flash("הנוסח נשמר"); }}>שמירת נוסח</button>
          <button type="button" className="facBtn" onClick=${() => { setDraft(text); setMode(""); }}>ביטול</button>
          <button type="button" className="facBtn" title="חזרה לנוסח המקורי" onClick=${() => setDraft(MSG_921)}>נוסח מקורי</button>
        </div></div>`}
    </div></div>`;
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
          <td className="num">${i + 1}</td>
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

// ----------------------------------------------------------------------------- the finishes list
// 06.11.26 — the products come from LLI (or are typed in); four documents per
// product, each V / not relevant / open. Every supplier picked joins the
// project's contacts (once, under "ספקים"), with what the catalogue knows
// about it. The service department lives in the suppliers' library: once it is
// there, the column is V by itself on every project.
const NEXT = { "": "v", v: "na", na: "", auto: "na" };
// A picture for a row: shrunk to fit the cell and the print (as LLI does).
function finThumb(file, max) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => reject(new Error("image"));
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function FinishesChapter({ data, edit, bar, projectName, print, flash, lliItems, contacts, catalog, onAddContacts, lib, reloadLib, projectId, boardExport }) {
  const [picking, setPicking] = useState(false);
  const [exportAsk, setExportAsk] = useState(null);   // "pdf" | "xlsx" — the report-details window
  const [mailOpen, setMailOpen] = useState(false);    // the envelope's window
  const finMsg = (data.msgs || {}).finishes ?? MSG_921;
  const [pick, setPick] = useState({});
  const [q, setQ] = useState("");
  const [svcFor, setSvcFor] = useState(null);     // supplier name whose service department is open
  const rows = data.finishes || [];
  const patch = (id, fn) => edit((d) => { d.finishes = (d.finishes || []).map((r) => (r.id === id ? fn({ ...r }) : r)); return d; });
  const remove = (r) => {
    if (!confirm(`להסיר את "${r.desc || r.mark || "השורה"}" מהרשימה?`)) return;
    edit((d) => { d.finishes = (d.finishes || []).filter((x) => x.id !== r.id); return d; });
  };
  const have = new Set(rows.map((r) => r.code).filter(Boolean));
  const avail = (lliItems || []).filter((it) => !have.has(it.code));
  const qq = q.trim().toLowerCase();
  const shownAvail = avail.filter((it) => !qq || `${it.mark} ${it.desc} ${it.supplier} ${it.categoryLabel}`.toLowerCase().includes(qq));
  // A row picked from LLI shows LLI's picture until one of its own is set.
  const lliByCode = useMemo(() => { const m = {}; (lliItems || []).forEach((it) => { m[it.code] = it; }); return m; }, [lliItems]);
  const imageOf = (r) => r.image || (r.code && !r.noImage && (lliByCode[r.code] || {}).image) || null;
  const putImage = async (r, f) => {
    if (!f) return;
    try {
      const thumb = await finThumb(f, 640);
      patch(r.id, (x) => ({ ...x, image: thumb, noImage: false }));
      try { imgLibAdd({ projectId, projectName, source: "facility", dataUrl: thumb, file: f, label: [r.mark, r.desc].filter(Boolean).join(" \u00b7 ") || "תיק מתקן" }); } catch (e) {}
    } catch (e) { console.warn("[facility] image failed", e); flash("טעינת התמונה נכשלה"); }
  };

  // The suppliers of the rows just added, into the project's contacts — once
  // each, and filled from the catalogue when it knows the company.
  const addSuppliersToContacts = (names) => {
    if (!onAddContacts) return 0;
    const inContacts = new Set((contacts || []).filter((c) => c.group === "suppliers")
      .map((c) => supLibNorm((c.company && (c.company.he || c.company.en)) || ((catalog.companies || []).find((x) => x.id === c.companyId) || {}).he || "")));
    const add = [];
    Array.from(new Set(names.map((n) => String(n || "").trim()).filter(Boolean))).forEach((name) => {
      if (inContacts.has(supLibNorm(name))) return;
      const co = (catalog.companies || []).find((x) => supLibNorm(x.he) === supLibNorm(name) || supLibNorm(x.en) === supLibNorm(name));
      const pp = co ? (catalog.people || []).find((x) => x.companyId === co.id) : null;
      add.push({
        id: `ct-${Date.now()}-${Math.round(Math.random() * 1e6)}`, group: "suppliers", disciplineId: null,
        companyId: co ? co.id : null, company: { he: name, en: (co && co.en) || "" },
        person: { ...((pp && pp.person) || { he: "", en: "" }) }, roleId: (pp && pp.roleId) || null,
        phone: (pp && pp.phone) || "", email: (pp && pp.email) || ""
      });
      inContacts.add(supLibNorm(name));
    });
    if (add.length) onAddContacts(add);
    return add.length;
  };
  const addPicked = () => {
    const chosen = avail.filter((it) => pick[it.code]);
    if (!chosen.length) { setPicking(false); return; }
    edit((d) => {
      d.finishes = (d.finishes || []).concat(chosen.map((it) => ({
        id: uid(), code: it.code, mark: it.mark, desc: it.desc, supplier: it.supplier, category: it.categoryLabel, image: it.image || null, note: "", cells: {}
      })));
      return d;
    });
    const n = addSuppliersToContacts(chosen.map((it) => it.supplier));
    setPick({}); setPicking(false); setQ("");
    flash(n ? `נוספו ${chosen.length} מוצרים · ${n} ספקים נוספו לאנשי הקשר` : `נוספו ${chosen.length} מוצרים`);
  };
  const addManual = () => edit((d) => { d.finishes = (d.finishes || []).concat([{ id: uid(), code: "", mark: "", desc: "", supplier: "", category: "", image: null, note: "", cells: {} }]); return d; });
  const subject = `${projectName || ""} – תיק מתקן – הוראות תחזוקה, אחריות, ת"י 755 ומחלקת בדק`.replace(/^ – /, "");
  const suppliersOpen = Array.from(new Set(rows.filter((r) => finRowState(r, lib) === "open").map((r) => r.supplier).filter(Boolean)));
  const mailOf = (name) => {
    const c = (contacts || []).find((x) => x.group === "suppliers" && supLibNorm((x.company && (x.company.he || x.company.en)) || "") === supLibNorm(name));
    return c && String(c.email || "").includes("@") ? c.email.trim() : "";
  };
  const openEmails = suppliersOpen.map(mailOf).filter(Boolean);
  const listId = "facSupHints";
  const supNames = Array.from(new Set((lib || []).map((s) => s.name).concat(rows.map((r) => r.supplier)).filter(Boolean))).sort();

  // ------------------------------------------------ PDF / Excel (06.11.26)
  // The columns that came from LLI, the four documents and the notes — in the
  // boards' print design, ordered by category with a heading for each, the
  // pictures inside their cells, done rows in green.
  const REPORT = "רשימת חומרי גמר – תיק מתקן";
  const finTitles = () => ({
    title: (projectName || "").trim() || REPORT,
    subtitle: REPORT,
    date: `תאריך הנפקת דוח ${boardExport && boardExport.fmtDate ? boardExport.fmtDate(new Date().toISOString().slice(0, 10)) : new Date().toLocaleDateString("he-IL")}`
  });
  const doExport = async (kind, hdr) => {
    if (!boardExport || !rows.length) return;
    const H = hdr || finTitles();
    const head = ["קטגוריה", "איפיון", "תיאור הסעיף", "ספק", "תמונה"].concat(FIN_COLS.map(([, l]) => l)).concat(["הערות"]);
    const imgCol = 4;
    const widths = [13, 8, 24, 14, 11, 10, 9, 8, 10, 18];
    const cellTxt = (v) => (v === "v" || v === "auto" ? "V" : v === "na" ? "ל״ר" : "");
    const cats = [];
    rows.forEach((r) => { const c = String(r.category || "").trim() || "ללא קטגוריה"; if (!cats.includes(c)) cats.push(c); });
    const body = [], imgs = [], tone = [], secs = [], ranks = [];
    rows.forEach((r) => {
      const c = String(r.category || "").trim() || "ללא קטגוריה";
      body.push([String(r.category || "").trim(), r.mark || "", r.desc || "", r.supplier || "", ""]
        .concat(FIN_COLS.map(([k]) => cellTxt(finCell(r, k, lib)))).concat([r.note || ""]));
      imgs.push(imageOf(r));
      const st = finRowState(r, lib);
      tone.push(st === "done" ? "ok" : "");
      secs.push(c); ranks.push(cats.indexOf(c));
    });
    const O = boardExport.orderBy({ body, imgs, tone }, secs, ranks);
    const toneRows = H.tones === false ? null : O.tone;
    try {
      if (kind === "pdf") {
        boardExport.pdf({
          title: H.title, subtitle: H.subtitle, issuedLabel: H.date,
          fileName: boardExport.fileName(REPORT, ""),
          head, body: O.body, widths, sections: O.secs, imgCol, imgs: O.imgs, toneRows, noStamp: true
        });
      } else {
        const res = await boardExport.xlsx({
          title: H.title, subtitle: [H.subtitle, H.date].filter((x) => String(x || "").trim()).join(" \u00b7 "),
          sheetName: "חומרי גמר", fileName: boardExport.fileName(REPORT, "xlsx"),
          head, body: O.body, sections: O.sections, widths, colTypes: head.map(() => "text"),
          imgCol, imgs: O.imgs, toneRows
        });
        if (res && res.styled === false) flash("הקובץ נשמר ללא עיצוב");
      }
    } catch (e) { console.warn("[facility] export failed", e); flash("ההפקה נכשלה"); }
  };

  return html`<${F}>
    ${bar(html`<${F}>
      <button type="button" className="facBtn" onClick=${() => setPicking((x) => !x)}><${ListPlus} size=${15} strokeWidth=${2.2} /> בחירה מתוך LLI</button>
      <button type="button" className="facBtn" onClick=${addManual}><${Plus} size=${15} strokeWidth=${2.4} /> שורה</button>
      <button type="button" className="facBtn icon" title="נוסח ההודעה לספקים"
        onClick=${() => setMailOpen(true)}><${Mail} size=${16} /></button>
      ${boardExport && html`<${F}>
        <button type="button" className="facBtn" disabled=${!rows.length} title="הדפסת רשימת חומרי הגמר ל-PDF" onClick=${() => setExportAsk("pdf")}><${FileText} size=${15} /> PDF</button>
        <button type="button" className="facBtn" disabled=${!rows.length} title="רשימת חומרי הגמר לאקסל, עם התמונות" onClick=${() => setExportAsk("xlsx")}><${FileSpreadsheet} size=${15} /> Excel</button><//>`}<//>`)}
    ${exportAsk && html`<${PrintLangAsk} startLang="he" titles=${finTitles}
      onPick=${(lg, who, hdr) => { const k = exportAsk; setExportAsk(null); doExport(k, hdr); }} onClose=${() => setExportAsk(null)} />`}
    ${mailOpen && html`<${MailMenu} text=${finMsg} subject=${subject} bcc=${openEmails.join(",")} flash=${flash} onClose=${() => setMailOpen(false)}
      onSave=${(t) => edit((d) => { d.msgs = d.msgs || {}; d.msgs.finishes = t; return d; })} />`}
    ${picking && html`<div className="facPick">
      <div className="facPickBar">
        <span style=${{ fontWeight: 800 }}>מוצרים מתוך LLI (${avail.length})</span>
        <span className="facPickSearch"><${Search} size=${14} /><input value=${q} placeholder="חיפוש" onChange=${(e) => setQ(e.target.value)} /></span>
        <label className="facPickAll"><input type="checkbox" checked=${shownAvail.length > 0 && shownAvail.every((it) => pick[it.code])}
          onChange=${(e) => { const n = { ...pick }; shownAvail.forEach((it) => { n[it.code] = e.target.checked; }); setPick(n); }} /> סימון הכול</label>
        <button type="button" className="facBtn primary" onClick=${addPicked}>הוספה לרשימה (${avail.filter((it) => pick[it.code]).length})</button>
        <button type="button" className="facBtn icon" title="סגירה" onClick=${() => setPicking(false)}><${X} size=${15} /></button>
      </div>
      ${avail.length === 0 && html`<p className="facEmpty">כל המוצרים של LLI כבר ברשימה.</p>`}
      ${shownAvail.length > 0 && html`<div className="facPickRow" style=${{ cursor: "default", fontWeight: 800, fontSize: 12, color: "#5b5e66", background: "#f4f6f9" }}>
        <span></span><span className="c">קטגוריה</span><span className="m">איפיון</span><span>תיאור הסעיף</span><span className="s">ספק</span><span style=${{ textAlign: "center" }}>תמונה</span></div>`}
      <div className="facPickList">${shownAvail.map((it) => html`<label key=${it.code} className="facPickRow">
        <input type="checkbox" checked=${!!pick[it.code]} onChange=${(e) => setPick({ ...pick, [it.code]: e.target.checked })} />
        <span className="c">${it.categoryLabel || ""}</span><b className="m" dir="ltr">${it.mark || ""}</b><span className="d">${it.desc || it.code}</span>
        <span className="s">${it.supplier || "— ללא ספק —"}</span>
        <span className="pic">${it.image ? html`<img src=${it.image} alt="" />` : null}</span>
      </label>`)}</div>
    </div>`}
    <datalist id=${listId}>${supNames.map((h) => html`<option key=${h} value=${h} />`)}</datalist>
    <div className="facWin"><table className="finTbl">
      <thead><tr><th>#</th><th>קטגוריה</th><th>איפיון</th><th style=${{ textAlign: "start" }}>תיאור הסעיף</th><th>ספק</th><th>תמונה</th>
        ${FIN_COLS.map(([k, l]) => html`<th key=${k}>${l}</th>`)}<th>הערות</th><th></th></tr></thead>
      <tbody>
        ${rows.length === 0 && html`<tr><td colSpan=${8 + FIN_COLS.length} className="facEmpty">הרשימה ריקה — לחצי על "בחירה מתוך LLI"</td></tr>`}
        ${rows.map((r, i) => {
          const rs = finRowState(r, lib);
          return html`<tr key=${r.id} className=${rs === "done" ? "ok" : rs === "na" ? "na" : ""}>
            <td className="num">${i + 1}</td>
            <td style=${{ width: 100 }}><input className="facIn" style=${{ fontSize: 12.5 }} value=${r.category || ""} onChange=${(e) => patch(r.id, (x) => ({ ...x, category: e.target.value }))} /></td>
            <td style=${{ width: 70 }}><input className="facIn" dir="ltr" value=${r.mark || ""} onChange=${(e) => patch(r.id, (x) => ({ ...x, mark: e.target.value }))} /></td>
            <td className="lbl"><input className="facIn" value=${r.desc || ""} onChange=${(e) => patch(r.id, (x) => ({ ...x, desc: e.target.value }))} /></td>
            <td><input className="facIn" list=${listId} value=${r.supplier || ""} placeholder="שם הספק"
              onChange=${(e) => patch(r.id, (x) => ({ ...x, supplier: e.target.value }))}
              onBlur=${(e) => { if (e.target.value.trim()) addSuppliersToContacts([e.target.value]); }} /></td>
            <td style=${{ width: 60 }}>${(() => {
              const src = imageOf(r);
              return html`<div className="finPic" title="לחיצה: החלפת תמונה · לחצן ימני: ספריית התמונות"
                onClick=${(e) => imgAsk(e, { projectId, onFile: (f) => putImage(r, f) })}
                ...${imgPickProps({ projectId, onFile: (f) => putImage(r, f) })}>
                ${src ? html`<img src=${src} alt="" />` : html`<${ImagePlus} size=${16} />`}
                ${src && html`<button type="button" className="finPicX" title="הסרת התמונה"
                  onClick=${(e) => { e.stopPropagation(); patch(r.id, (x) => ({ ...x, image: null, noImage: true })); }}><${X} size=${11} /></button>`}
              </div>`;
            })()}</td>
            ${FIN_COLS.map(([k]) => {
              const v = finCell(r, k, lib);
              return html`<td key=${k} className=${v === "v" || v === "auto" ? "cellV" : v === "na" ? "cellNa" : ""}>
                <div style=${{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
                  <button type="button" className=${`tri ${v === "auto" ? "v" : v}`}
                    title=${v === "auto" ? "פרטי מחלקת הבדק נמצאים במאגר הספקים" : "לחיצה: V ← לא רלוונטי ← ריק"}
                    onClick=${() => patch(r.id, (x) => ({ ...x, cells: { ...(x.cells || {}), [k]: NEXT[v] } }))}>${v === "v" || v === "auto" ? "✓" : v === "na" ? "ל״ר" : ""}</button>
                  ${k === "service" && r.supplier && html`<button type="button" className="facBtn icon" title="פרטי מחלקת בדק (במאגר הספקים)"
                    onClick=${() => setSvcFor(svcFor === r.supplier ? null : r.supplier)}><${Pencil} size=${13} /></button>`}
                </div></td>`;
            })}
            <td className="finNote"><input className="facIn" value=${r.note || ""} placeholder="הערות"
              onChange=${(e) => patch(r.id, (x) => ({ ...x, note: e.target.value }))} /></td>
            <td style=${{ whiteSpace: "nowrap" }}>
              ${mailOf(r.supplier) && html`<button type="button" className="facBtn icon" title="מייל לספק"
                onClick=${() => openMail({ to: mailOf(r.supplier), subject, body: finMsg })}><${Mail} size=${14} /></button>`}
              <button type="button" className="facBtn icon" title="הסרה" onClick=${() => remove(r)}><${Trash2} size=${14} color="#b02a37" /></button>
            </td>
          </tr>`;
        })}
      </tbody>
    </table></div>
    ${svcFor && html`<${ServiceBox} name=${svcFor} lib=${lib} reloadLib=${reloadLib} flash=${flash} print=${print} rows=${rows} onClose=${() => setSvcFor(null)} />`}
    <div className="facLegend">
      <span><i style=${{ background: "#e3f3e6" }} />V — התקבל</span>
      <span><i style=${{ background: "#f4f4f6" }} />לא רלוונטי</span>
      <span>פרטי מחלקת בדק שנמצאים במאגר הספקים מסומנים V מעצמם</span>
    </div><//>`;
}

// The service department of one supplier — kept in the suppliers' library, so
// it is filled once and counts on every project.
function ServiceBox({ name, lib, reloadLib, flash, print, rows, onClose }) {
  const cur = supLibFind(lib, name);
  const [v, setV] = useState(() => ({ ...(((cur || {}).data || {}).service || {}) }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const base = cur || { name, data: {} };
      await supLibSave({ ...base, name: base.name || name, data: { ...(base.data || {}), service: v } });
      await reloadLib(true);
      flash("פרטי מחלקת הבדק נשמרו במאגר הספקים");
      onClose();
    } catch (e) {
      flash("השמירה במאגר נכשלה: " + ((e && e.message) || ""));
    } finally { setBusy(false); }
  };
  return html`<div className="facMsg">
    <div style=${{ fontWeight: 800, marginBottom: 8 }}>פרטי מחלקת הבדק והשירות — ${name}${cur ? "" : " (ספק חדש במאגר)"}</div>
    <div className="facSvcGrid">
      ${[["name", "שם איש קשר"], ["phone", "מספר טלפון"], ["mobile", "מספר נייד"], ["email", "כתובת מייל"]].map(([k, l]) => html`
        <label key=${k}>${l}<input className="facIn" dir=${k === "name" ? "rtl" : "ltr"} value=${v[k] || ""} onChange=${(e) => setV({ ...v, [k]: e.target.value })} /></label>`)}
    </div>
    <div style=${{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
      <button type="button" className="facBtn primary" disabled=${busy} onClick=${save}><${Save} size=${15} /> שמירה במאגר הספקים</button>
      <button type="button" className="facBtn" onClick=${() => print && print.serviceSheet([{ name, product: rows.filter((r) => r.supplier === name).map((r) => r.desc).join(", "), service: v }])}><${Printer} size=${15} /> PDF</button>
      <button type="button" className="facBtn" onClick=${onClose}><${X} size=${15} /> סגירה</button>
    </div>
  </div>`;
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
          <td className="num">${i + 1}</td>
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
