// =============================================================================
//  sign.js — the review-and-approval screen, and nothing else.
//  A. Weiss project dashboard · 15.9.2026 — carries its own CSS (signCss)
// =============================================================================
//
//  One screen, one copy of it. The dashboard imports it for the client, and the
//  supervision page imports it for a supervisor arriving by link. Two copies
//  would drift apart the first time one of them was corrected and the other
//  forgotten, and a signing screen that behaves differently depending on how
//  you reached it is exactly the thing that must not exist.
//
//  It carries the document viewer, the decisions, the signature pad and the
//  printed sheet — and no part of the dashboard: no projects, no bill of
//  quantities, no other submittal. It cannot reach them and is not given them.
// =============================================================================

import React15, { useState as useState6, useRef as useRef5, useEffect as useEffect5 } from "react";
import {
  AirVent as AirVent2, Building2 as Building23, Cctv as Cctv2, Droplets as Droplets2,
  FileText as FileTextIcon, Grid3x3 as Grid3x32, Layers as Layers2,
  Lightbulb as Lightbulb2, PanelTop as PanelTop2, Zap as Zap2,
  PenLine, Printer, Stamp, Upload as Upload3, X as X4, ArrowLeft, ArrowRight,
  // the drawing-signing screen keeps its own aliases (moved here 15.9.26)
  Download as DownloadSd, PenLine as PenLineSd, X as XSd, Move as MoveSd, Check as CheckSd, Stamp as StampSd, ArrowLeft as ArrowLeftSd, ArrowRight as ArrowRightSd
} from "lucide-react";
// The print-language question and the signature pad open over the page, so
// they are portalled to the body — the same way the dashboard does it.
import { createPortal } from "react-dom";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

var SUBMITTAL_BUCKET = "submittals";var SB_PRINT_PAGE_CAP = 40;
// An attachment with no page list covers the whole file. One that has a list
// covers exactly those pages — that is how a product gets only its own spec.
var PDFJS_VERSION = "3.11.174";
var PDFJS_SOURCES = [
  {
    lib: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`,
    worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`
  },
  {
    lib: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`,
    worker: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`
  },
  {
    lib: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`,
    worker: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`
  }
];
var pdfJsLoadingPromise = null;
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}
async function loadPdfJs() {
  if (typeof window !== "undefined" && window.pdfjsLib) return window.pdfjsLib;
  if (pdfJsLoadingPromise) return pdfJsLoadingPromise;
  pdfJsLoadingPromise = (async () => {
    let lastErr = null;
    for (const source of PDFJS_SOURCES) {
      try {
        await loadScriptOnce(source.lib);
        if (!window.pdfjsLib) throw new Error("pdfjsLib not defined after script load");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = source.worker;
        return window.pdfjsLib;
      } catch (e) {
        lastErr = e;
        console.error("PDF.js source failed:", source.lib, e);
      }
    }
    pdfJsLoadingPromise = null;
    throw lastErr || new Error("All PDF.js sources failed to load");
  })();
  return pdfJsLoadingPromise;
}var SUPABASE_URL = "https://jvssavyfjuhjniqkiymo.supabase.co";
var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9FY_yBz2KLVfVYdxPbvBHw_Xx233xC4";
var supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : void 0
  }
});
// Bump this when the disclaimer wording changes; each acceptance records which
// version the user agreed to (their "signature").

var PRINT_PAGE_MM = 210;
// The white edge of the paper. 12mm is the measurement the reports were set up
// with and the one she signed off on; 8mm put the frame too close to the edge
// (30.8.26).
var PRINT_MARGIN_MM = 12;
// A4 landscape is 297mm across. The frame lives inside the margin on all four
// sides, so its box is the paper less twice the margin.
var PRINT_WIDE_MM = 297;
// ---------------------------------------------------------------------------
//  One shell for every document this app issues (7.9.26)
//
//  The drawings register, the ordering board, the schedule, the contacts
//  sheet, the submittal form and the user list are all the same piece of
//  paper: an A4 sheet, a rounded frame set in from all four edges, the
//  company strip at the foot of the sheet and the printed-on line under it.
//  Each builder used to write its own version of that and they had drifted
//  apart — different margins, different footers, different behaviour on the
//  last page. They share this shell now, so a change here is a change to
//  every document she issues.
//
//  Two measurements are worth spelling out, because both were bugs she had
//  to find on paper:
//
//  * The sheet is the WHOLE page and the white edge is this box's padding,
//    not a @page margin. A @page margin leaves the browser's own margin
//    setting free to disagree with ours, and when it does a fixed-width
//    frame has nowhere to put the difference: in an RTL document all of it
//    lands on one side and the frame sits hard against the other edge of
//    the paper. Padding cannot drift — the frame is centred by the sheet.
//
//  * The frame is the full height of the sheet on EVERY page, the last one
//    included. A frame that closes under the last row reads as a page that
//    was cut short rather than a page that ended.
// ---------------------------------------------------------------------------

function printedStampText(lang) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  // The date, and not the hour. A sheet needs to say which day it is from;
  // 22:16 tells a reader nothing and makes two copies of the same day's
  // report look like two different documents (7.9.26).
  const when = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  return lang === "he" ? `הודפס בתאריך ${when}` : `Printed on ${when}`;
}
// `bottomMm` puts it inside whatever page padding the document already has.
function sanitizeFileNamePart(s) {
  return String(s || "").trim().replace(/[\\/:*?"<>|]/g, "-");
}
// The key a file is stored under. Supabase Storage refuses a key with Hebrew
// letters or spaces in it — "Invalid key" — and every Hebrew file name she
// uploaded was failing that way and quietly falling back to an inline copy
// inside the record. The key is internal and nobody ever reads it, so it is
// made of plain ASCII; the file keeps its real name in the record beside it
// (29.8.26).
function printSheetCss(o) {
  const opts = o || {};
  const wide = !!opts.landscape;
  const w = wide ? PRINT_WIDE_MM : PRINT_PAGE_MM;
  const h = wide ? PRINT_PAGE_MM : PRINT_WIDE_MM;
  const m = opts.marginMm == null ? PRINT_MARGIN_MM : opts.marginMm;
  const accent = opts.accent || "#14265e";
  const pad = opts.framePad || "5mm 6mm";
  return `
@page { size: A4 ${wide ? "landscape" : "portrait"}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* One printed sheet. A hair under the paper height: asked for the last
   millimetre some browsers round up and deal out a blank page after every
   real one. */
.page { width: ${w}mm; height: ${(h - 0.2).toFixed(1)}mm; padding: ${m}mm; margin: 0 auto;
  background: #fff; overflow: hidden; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
/* Inside the white edge: the frame, and under it the company strip and the
   printed-on line. They sit BELOW the frame's bottom rule, at the foot of the
   sheet — not inside the frame with the table (7.9.26). */
.sheet { height: 100%; display: flex; flex-direction: column; }
.frame { flex: 1 1 auto; min-height: 0; border: 1.5px solid ${accent}; border-radius: 12px;
  padding: ${pad}; display: flex; flex-direction: column; overflow: hidden; }
.pgBody { flex: 1 1 auto; min-height: 0; }
/* A form, rather than a table of rows: its own boxes share out the height. */
.pgBody.flow { display: flex; flex-direction: column; }
/* The same block of space is kept under the frame on every page, so every
   frame ends on the same line whether or not the strip is printed there. */
.pgFoot { flex: 0 0 auto; padding-top: 2.5mm; }
.footImg { text-align: center; }
.footImg img { width: 50%; height: auto; display: block; margin: 0 auto; }
.pageStamp { text-align: center; font-size: 7.5px; font-weight: 600; color: #9aa3af;
  letter-spacing: .2px; direction: ltr; unicode-bidi: plaintext; padding-top: 1.5mm; }
@media screen {
  body { background: #eef1f5; padding: 8mm 0; }
  .page { margin: 0 auto 8mm; box-shadow: 0 2px 14px -6px rgba(0,0,0,.35); }
}
/* Where the document is written before it is dealt into pages. */
#src { position: absolute; left: -9999px; top: 0; width: ${w - 2 * m - 14}mm; }
`;
}
// The whole sheet, for a document that is one page by design — the submittal
// form, or a page of specifications appended after it.
function printStaticPage(inner, o) {
  const opts = o || {};
  const foot = opts.footHtml || "";
  const stamp = `<div class="pageStamp">${String(opts.stamp || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</div>`;
  return `<div class="page"><div class="sheet"><div class="frame"><div class="pgBody${opts.flow ? " flow" : ""}">${inner}</div></div><div class="pgFoot">${foot}${stamp}</div></div></div>`;
}
// ---------------------------------------------------------------------------
//  The pages are cut here, not left to the browser.
//
//  A frame drawn with position:fixed only ever framed the first page: the rows
//  kept flowing under it and anything painted outside the page's own content
//  box was clipped away. So the document is written as ONE table and this
//  script deals the rows into real pages — each a self-contained sheet with
//  its own frame, its own heading row and nothing crossing the border.
// ---------------------------------------------------------------------------
var sbH = React15.createElement;

// -----------------------------------------------------------------------------
// WHICH LANGUAGE TO PRINT IN.
//
// A document that leaves the office is not always in the language the office is
// working in: she works in Hebrew all day and still has to send an English
// submittal to a client. That used to be a language switch sitting permanently
// on the submittal screen — which put the setting somewhere else entirely at the
// moment it mattered, and changed what SHE saw and not only what the client got.
//
// So it is asked where it belongs: on the way to the printer. Every PDF in the
// site goes through here. The question itself is written in both languages,
// because at that moment we do not yet know which one the reader wants.
// -----------------------------------------------------------------------------
var SUBMITTAL_CATEGORIES = [
  { key: "architecture", en: "Architecture", he: "אדריכלות", icon: Building23 },
  { key: "flooring", en: "Flooring", he: "ריצוף", icon: Grid3x32 },
  // Her own catalogue calls this chapter "גמרים / Finishes"; the key stays
  // "cladding" so every submittal already numbered Cladding-00x keeps its name.
  { key: "cladding", en: "Finishes", he: "גמרים", code: "Cladding", icon: Layers2 },
  { key: "ceiling", en: "Ceiling", he: "תקרה", icon: PanelTop2 },
  { key: "electrical", en: "Electrical", he: "חשמל", icon: Zap2 },
  { key: "lighting", en: "Lighting", he: "תאורה", icon: Lightbulb2 },
  { key: "hvac", en: "HVAC", he: "מיזוג אוויר", icon: AirVent2 },
  { key: "plumbing", en: "Plumbing", he: "אינסטלציה", icon: Droplets2 },
  // Sometimes priced in the bill of quantities, sometimes not priced at all —
  // so it is an ordinary folder here, and a project where nothing is submitted
  // simply leaves it empty and puts the information in the electrician's
  // special-specifications folder instead. (8.9.26)
  { key: "security", en: "Security, Controls & Communications", he: "ביטחון, בקרה ותקשורת", code: "Security", icon: Cctv2 }
];
// Joinery is a trade on the boards but not a submittal folder: carpentry is
// approved by a shop drawing and chased as a delivery, and nobody submits a
// material sheet for it. So it lives on LLI and SD and stays off the submittal
// screen — her own instruction, 29.8.26.
var SB_SUBCATS = {
  architecture: [
    ["Glass", "זכוכית"],
    ["Mirrors", "מראות"],
    ["Films & Graphics", "ציפויים ומדבקות"],
    ["Whiteboards", "לוחות מחיקים"],
    ["Curtains & Blinds", "וילונות והצללה"],
    ["Internal Signage", "שילוט פנים"],
    ["External Signage", "שילוט חוץ"],
    ["Wall Protection", "הגנות קיר"],
    ["Architectural Accessories", "אביזרים אדריכליים"]
  ],
  flooring: [
    ["LVT", "LVT"],
    ["Carpets", "שטיחים"],
    ["Carpet Tiles", "אריחי שטיח"],
    ["Porcelain Tiles", "גרניט פורצלן"],
    ["Ceramic Tiles", "קרמיקה"],
    ["Raised Access Flooring", "רצפה צפה"],
    ["Communication Room Flooring", "ריצוף חדרי תקשורת"],
    ["Flooring Adhesives", "דבקים לריצוף"],
    ["Underlay", "שכבות תשתית"]
  ],
  cladding: [
    ["Paints", "צבעים"],
    ["Wall Cladding", "חיפויי קיר"],
    ["Acoustic Panels", "פנלים אקוסטיים"],
    ["Tiles", "אריחים"],
    ["Grout", "רובה"],
    ["Sealants", "חומרי איטום"],
    ["Adhesives", "דבקים"],
    ["Skirting", "פנלים / סוקלים"],
    ["Decorative Finishes", "גמרים דקורטיביים"]
  ],
  ceiling: [
    ["Acoustic Ceiling Tiles", "אריחי תקרה אקוסטית"],
    ["Ceiling Grid", "גריד תקרה"],
    ["Metal Ceilings", "תקרות מתכת"],
    ["Acoustic Baffles", "באפלים אקוסטיים"],
    ["Suspension Systems", "מערכות תלייה"],
    ["Access Panels", "פתחי שירות"]
  ],
  electrical: [
    ["Electrical Panels", "לוחות חשמל"],
    ["UPS", "UPS"],
    ["Cables", "כבלים"],
    ["Cable Trays", "תעלות כבלים"],
    ["Sockets", "שקעים"],
    ["Floor Boxes", "קופסאות רצפה"],
    ["Switches", "מפסקים"],
    ["Transformers", "שנאים"],
    ["Earthing Equipment", "ציוד הארקה"],
    ["Emergency Power Equipment", "ציוד חשמל חירום"],
    ["BMS", "בקרת מבנה BMS"],
    ["BMS Controllers", "בקרי BMS"],
    ["BMS Sensors", "חיישני BMS"],
    ["Actuators", "אקטואטורים"],
    ["BMS Control Panels", "לוחות בקרת מבנה"],
    ["Communication Gateways", "ממשקי תקשורת / Gateways"]
  ],
  lighting: [
    ["Lighting Fixtures", "גופי תאורה"],
    ["Emergency Lighting", "תאורת חירום"],
    ["LED Profiles", "פרופילי LED"],
    ["Drivers", "דרייברים"],
    ["DALI Components", "רכיבי DALI"],
    ["Lighting Control", "בקרת תאורה"],
    ["Sensors", "חיישנים"]
  ],
  hvac: [
    ["FCU Units", "יחידות מיזוג FCU"],
    ["AHU Units", "יחידות AHU"],
    ["VRF/VRV Units", "יחידות VRF/VRV"],
    ["Fans", "מפוחים"],
    ["Grilles & Diffusers", "גרילים ומפזרים"],
    ["Dampers", "דמפרים"],
    ["Fire & Smoke Dampers", "דמפרי אש ועשן"],
    ["Control Valves", "ברזי בקרה"],
    ["Pumps", "משאבות"],
    ["Piping", "צנרת"],
    ["Ductwork", "תעלות אוויר"],
    ["Insulation", "בידוד"],
    ["Thermostats", "תרמוסטטים"]
  ],
  plumbing: [
    ["Sanitary Fixtures", "כלים סניטריים"],
    ["Faucets", "ברזים"],
    ["Sinks", "כיורים"],
    ["Toilets", "אסלות"],
    ["Urinals", "משתנות"],
    ["Drains", "נקזים"],
    ["Traps", "סיפונים"],
    ["Backflow Preventers", "מז״ח"],
    ["Pumps", "משאבות"],
    ["Water Softeners", "מרככי מים"],
    ["Pipes & Fittings", "צנרת ואביזרים"],
    ["Valves", "מגופים"]
  ],
  // Joinery — a starting list, not from her sheet (29.8.26). It is here so the
  // LLI and SD boards have something concrete to pick from; say the word and
  // the entries change.
  joinery: [
    ["Joinery", "נגרות אומן"],
    ["Built-in Furniture", "ריהוט מובנה"],
    ["Cupboards", "ארונות"],
    ["Counters & Desks", "דלפקים ועמדות"],
    ["Worktops", "משטחי עבודה"],
    ["Shelving", "מדפים"],
    ["Doors", "דלתות"],
    ["Wooden Doors", "דלתות עץ"],
    ["Fire Doors", "דלתות אש"],
    ["Glazed Fire Doors", "דלתות אש מזוגגות"],
    ["Glazed Doors", "דלתות מזוגגות"],
    ["Door Frames", "משקופים"],
    ["Wood Cladding", "חיפויי עץ"],
    ["Ironmongery", "פרזול"]
  ]
};
// -----------------------------------------------------------------------------
// The category cell on the boards.
//
// "Architecture" is true of a curtain, a mirror and a built-in cupboard alike,
// and saying it tells nobody what the row is. So the picker offers her own
// sub-category catalogue, grouped under the discipline each one belongs to:
// she picks "וילונות והצללה" and the row is a curtain, filed under
// architecture, and it lands in the chapter where architecture lives (29.8.26).
//
// The value carries both halves — "architecture|Curtains & Blinds" — so one
// choice settles the discipline and the detail together.
// -----------------------------------------------------------------------------
function sbSubcats(catKey) {
  return SB_SUBCATS[catKey] || [];
}
// Whatever the person typed or picked, store the English term when it is one of
// ours, so the value survives a language switch.
function sbSubcatLabel(value, catKey, lang) {
  const v = String(value || "").trim();
  if (!v) return "";
  const hit = sbSubcats(catKey).find((r) => r[0] === v || r[1] === v);
  if (!hit) return v;
  return lang === "he" ? hit[1] : hit[0];
}

// Every label in the sheet, in both languages. The Hebrew comes from the cell
// comments in the source workbook so the wording is Marcella's, not a
// translation of the English.
var SB_L = {
  formTitle: { en: "EQUIPMENT / MATERIAL SUBMITTAL", he: "הגשת ציוד / חומרים לאישור" },
  submittalNo: { en: "SUBMITTAL NO.", he: "מס' סבמיטל" },
  revision: { en: "Revision", he: "מהדורה / רוויזיה" },
  projectInfo: { en: "PROJECT INFORMATION", he: "פרטי הפרויקט" },
  projectName: { en: "Project Name", he: "שם הפרויקט" },
  date: { en: "Date", he: "תאריך" },
  dateCol: { en: "Submitted", he: "תאריך להגשה" },
  contractor: { en: "Contractor", he: "קבלן" },
  requiredApprovalDate: { en: "Required Approval Date", he: "תאריך נדרש לאישור" },
  // The submittal list's own column headings (29.8.26).
  catCol: { en: "Category", he: "קטגוריה" },
  itemCol: { en: "Item", he: "תיאור פריט" },
  typeCol: { en: "Type ID", he: "איפיון" },
  supplierCol: { en: "Supplier / Contractor", he: "ספק / קבלן" },
  dueCol: { en: "Approval due", he: "תאריך נדרש לאישור" },
  notesCol: { en: "My notes", he: "הערות שלי" },
  // The three dates on the tracking table say which date they are. "Date" on
  // its own was read as any of them (30.8.26).
  docsCol: { en: "Files", he: "קבצים" },
  fromContacts: { en: "From the project contacts", he: "מתוך אנשי הקשר של הפרויקט" },
  issuedOn: { en: "Report issued on", he: "תאריך הנפקת דוח" },
  nothingToExport: { en: "Nothing to export in this view.", he: "אין מה לייצא בתצוגה הזו." },
  exportAll: { en: "All disciplines", he: "כל הקטגוריות" },
  // The review list: documents the sorting could not place by itself. It is
  // not a bin — every row says what the reading found and why it stopped
  // (30.8.26).
  reviewTitle: { en: "Documents waiting to be placed", he: "מסמכים הממתינים לשיוך" },
  reviewHint: {
    en: "These were read but not filed. Each row says what was found and why it stopped there.",
    he: "המסמכים נקראו אך לא שויכו. כל שורה אומרת מה נמצא ולמה העבודה נעצרה שם."
  },
  reviewFiles: { en: "Documents", he: "מסמכים" },
  reviewProduct: { en: "What it is", he: "מהו המוצר" },
  reviewFinding: { en: "What was found", he: "ממצא" },
  reviewSuggested: { en: "Suggested BOQ line", he: "סעיף BOQ מוצע" },
  reviewConfidence: { en: "Confidence", he: "רמת התאמה" },
  reviewNoLine: { en: "Submittal probably missing on this line", he: "כנראה חסר סבמיטל בשורה הזו" },
  reviewSeveral: { en: "Several lines fit — pick one", he: "כמה שורות מתאימות — יש לבחור" },
  reviewNoMatch: { en: "Nothing on the checklist matches", he: "אין בצ׳ק‑ליסט סעיף מתאים" },
  confHigh: { en: "High", he: "גבוהה" },
  confMedium: { en: "Medium", he: "בינונית" },
  confLow: { en: "Low", he: "נמוכה" },
  reviewOpenHere: { en: "Open a submittal on this line", he: "פתיחת סבמיטל בשורה הזו" },
  // The list under the checklist, once the checklist exists: it holds only what
  // has no line of its own (30.8.26).
  unplacedList: { en: "Submittals on no checklist line", he: "סבמיטלים ללא שיוך לצ׳ק‑ליסט" },
  reviewDismiss: { en: "Remove from the list", he: "הסרה מהרשימה" },
  sentCol: { en: "Submission date", he: "תאריך הגשה" },
  targetCol: { en: "Approval target date", he: "תאריך יעד לאישור" },
  clientOkCol: { en: "Client approval date", he: "תאריך אישור לקוח" },
  // Taking a line off this board. It is not deleted from the bill of
  // quantities — the routing table keeps its tick, in grey (30.8.26).
  removeRow: { en: "Remove from this list", he: "הסרה מהרשימה" },
  removedSome: { en: "Removed from this list", he: "הוסרו מהרשימה" },
  restoreAll: { en: "Restore all", he: "החזרת הכל" },
  belongTo: { en: "Items covered by this submittal", he: "סעיפים שנכללים בסבמיטל הזה" },
  closedNoApproval: { en: "Closed — not approved", he: "סגור ללא אישור" },
  notesHint: {
    en: "Private notes on this submittal. They are not printed and nobody else sees them.",
    he: "הערות פרטיות על הסבמיטל הזה. הן לא מודפסות ואף אחד אחר לא רואה אותן."
  },
  discipline: { en: "Discipline", he: "תחום" },
  submittedBy: { en: "Submitted By", he: "הוגש על ידי" },
  scope: { en: "Scope", he: "תכולה" },
  subCategory: { en: "Sub-category", he: "תת קטגוריה" },
  email: { en: "E-mail", he: "דוא\"ל" },
  equipment: { en: "EQUIPMENT / MATERIAL DETAILS", he: "פרטי ציוד / חומר" },
  typeId: { en: "Type ID", he: "מזהה סוג" },
  itemDescription: { en: "Item Description", he: "תיאור הפריט" },
  modelCode: { en: "Model / Product Code", he: "דגם / מק\"ט מוצר" },
  manufacturer: { en: "Manufacturer", he: "יצרן" },
  picture: { en: "Picture", he: "תמונה" },
  addPicture: { en: "Add picture", he: "העלאת תמונה" },
  pasteHint: {
    en: "Click the box, then Ctrl+V to paste a picture. Double-click to choose a file.",
    he: "\u05dc\u05d5\u05d7\u05e6\u05d9\u05dd \u05e2\u05dc \u05d4\u05de\u05e1\u05d2\u05e8\u05ea \u05d5\u05d0\u05d6 Ctrl+V \u05dc\u05d4\u05d3\u05d1\u05e7\u05ea \u05ea\u05de\u05d5\u05e0\u05d4. \u05dc\u05d7\u05d9\u05e6\u05d4 \u05db\u05e4\u05d5\u05dc\u05d4 \u05dc\u05d1\u05d7\u05d9\u05e8\u05ea \u05e7\u05d5\u05d1\u05e5."
  },
  pickFile: { en: "Choose a file", he: "\u05d1\u05d7\u05d9\u05e8\u05ea \u05e7\u05d5\u05d1\u05e5" },
  documents: { en: "SUBMITTED DOCUMENTS", he: "מסמכים מצורפים" },
  additional: { en: "Additional Information", he: "מידע נוסף" },
  additionalEn: { en: "General information (English)", he: "מידע כללי על הציוד באנגלית" },
  additionalHe: { en: "General information (Hebrew)", he: "מידע כללי על הציוד בעברית" },
  review: { en: "REVIEW & APPROVAL", he: "בדיקה ואישור" },
  signature: { en: "Signature (Name & Date)", he: "חתימה (שם ותאריך)" },
  approvalComments: { en: "Approval Comments", he: "הערות לאישור" },
  specs: { en: "Specification files (PDF)", he: "מפרטים מצורפים (PDF)" },
  uploadSpec: { en: "Upload specification (PDF)", he: "העלאת מפרט (PDF)" },
  fillWithAi: { en: "Fill with AI", he: "מילוי אוטומטי בעזרת AI" },
  aiHint: {
    en: "The AI reads only the files uploaded here. Anything it cannot find is written as \"No information\".",
    he: "ה‑AI קורא אך ורק את הקבצים שהועלו כאן. כל סעיף שאין לו מקור נרשם כ‏\"אין מידע\"."
  },
  create: { en: "Create submittal", he: "צור סבמיטל" },
  noSubmittals: { en: "No submittals in this folder yet.", he: "עדיין אין סבמיטלים בתיקייה הזו." },
  trackingList: { en: "Tracking list", he: "רשימת מעקב" },
  // 7.9.26 — the labels of "Load specifications" went with the button. A
  // specification is loaded from inside the submittal it belongs to now.
  close: { en: "Close", he: "סגירה" },
  showCol: { en: "Show", he: "הצגה" },
  submittalList: { en: "Submittal list", he: "רשימת סבמיטלים" },
  checklist: { en: "Checklist from the bill of quantities", he: "צ׳ק‑ליסט מכתב הכמויות" },
  checklistHint: {
    en: "Every group in this discipline that needs an approval. A green line already has one.",
    he: "כל קבוצה בתחום הזה שדורשת אישור. שורה ירוקה כבר הוגשה."
  },
  checklistNone: {
    en: "No bill of quantities uploaded for this project, so there is nothing to check against yet.",
    he: "עדיין לא הועלה כתב כמויות לפרויקט, ולכן אין מול מה לבדוק."
  },
  checklistEmpty: { en: "The bill of quantities has nothing in this discipline.", he: "אין בכתב הכמויות פריטים בתחום הזה." },
  chkItem: { en: "BOQ", he: "BOQ" },
  chkDesc: { en: "Description", he: "תיאור" },
  chkDocs: { en: "documents attached", he: "מסמכים מצורפים" },
  chkExpired: { en: "The certificate expired on", he: "תוקף המסמך פג בתאריך" },
  chkMissingDocs: { en: "Missing", he: "חסר" },
  chkSubmittal: { en: "Submittal", he: "סבמיטל" },
  chkMissing: { en: "Not submitted", he: "טרם הוגש" },
  chkAdd: { en: "Submittal", he: "סבמיטל" },
  chkNewRev: { en: "A new version of", he: "גירסה חדשה של" },
  chkLines: { en: "The BOQ lines this product covers", he: "הסעיפים שהמוצר הזה מכסה" },
  chkLinesShort: { en: "lines", he: "שורות" },
  chkReview: { en: "Check", he: "לבדיקה" },
  chkReviewTitle: {
    en: "The classification of this item was not certain — worth a look in the routing table.",
    he: "הסיווג של הפריט הזה לא היה ודאי — כדאי לעבור עליו בטבלת הסיווג."
  },
  chkEquiv: { en: "or equivalent", he: "שו״ע" },
  chkSpecific: { en: "specific product", he: "ציוד ספציפי" },
  chkDone: { en: "submitted", he: "הוגשו" },
  status: { en: "Status", he: "סטטוס" },
  actions: { en: "", he: "" },
  save: { en: "Save", he: "שמירה" },
  cancel: { en: "Cancel", he: "ביטול" },
  open: { en: "Open", he: "פתיחה" },
  openPdf: { en: "PDF", he: "PDF" },
  pdfHint: {
    en: "The PDF opens in the browser and is never stored: the submittal on page one, the attached specifications on the pages after it.",
    he: "ה‑PDF נפתח בדפדפן ולא נשמר בשרת: הסבמיטל בעמוד הראשון, והמפרטים המצורפים בעמודים שאחריו."
  },
  print: { en: "Print / PDF", he: "הדפסה / PDF" },
  newRevision: { en: "New revision", he: "גירסה חדשה" },
  remove: { en: "Delete", he: "מחיקה" },
  confirmDelete: { en: "Delete this submittal?", he: "למחוק את הסבמיטל הזה?" },
  back: { en: "Back", he: "חזרה" },
  send: { en: "Send", he: "שליחה" },
  sent: { en: "Sent", he: "נשלח" },
  draft: { en: "Draft", he: "טיוטה" },
  signDate: { en: "Signature date", he: "תאריך חתימה" },
  signAction: { en: "Sign", he: "לחתום" },
  newlyApproved: { en: "Newly approved", he: "אושר עכשיו" },
  openDoc: { en: "Document", he: "מסמך" },
  viewSignOnly: {
    en: "You can open a submittal and sign it. Editing is the system administrator's.",
    he: "אפשר לפתוח סבמיטל ולחתום עליו. העריכה שמורה למנהלת המערכת."
  },
  saveSignature: { en: "Save signature", he: "שמירת החתימה" },
  signHere: { en: "Sign", he: "חתימה" },
  required: { en: "required", he: "חובה" },
  commentsPlaceholder: { en: "What has to change, or what the approval is conditional on", he: "מה נדרש לתקן, או במה מותנה האישור" },
  fileDecision: { en: "File the decision", he: "רישום ההחלטה" },
  pickDecision: { en: "Choose one of the four.", he: "בוחרים אחת מארבע האפשרויות." },
  needComment: { en: "This decision needs a note.", he: "ההחלטה הזו דורשת הערה." },
  needSignature: { en: "Sign, and the decision can be filed.", he: "חותמים, ואפשר לרשום את ההחלטה." },
  filingCloses: { en: "Filing closes the document. It can be printed afterwards, not changed.", he: "רישום ההחלטה סוגר את המסמך. אפשר יהיה להדפיס אותו, לא לשנות." },
  closedOn: { en: "Closed on", he: "נסגר בתאריך" },
  closedNote: { en: "Printing only — the decision has been filed.", he: "הדפסה בלבד — ההחלטה נרשמה." },
  closed: { en: "Closed", he: "סגור" },
  signColumn: { en: "Sign", he: "חתימה" },
  printPdf: { en: "Print / PDF", he: "הדפסה / PDF" },
  // 7.9.26 — the approved submittal, as a file to keep: the form, the
  // signature on it and the specifications behind it, in one PDF.
  printApproved: { en: "Save the approved submittal", he: "שמירת הסבמיטל המאושר" },
  printCol: { en: "Print", he: "הדפסה" },
  versionsCol: { en: "Versions", he: "גרסאות" },
  specsView: { en: "See the attached specifications", he: "צפייה במפרטים המצורפים" },
  specsNone: { en: "No specifications are attached to this submittal.", he: "לא צורפו מפרטים לסבמיטל הזה." },
  specsLoading: { en: "Opening the specifications…", he: "פותח את המפרטים…" },
  specsNoteHint: {
    en: "Click anywhere on a page to leave a note there. Notes are printed with the specifications.",
    he: "לחיצה על עמוד מוסיפה הערה במקום שנלחץ. ההערות מודפסות יחד עם המפרטים."
  },
  specsNoteAdd: { en: "Add a note", he: "הוספת הערה" },
  specsNoteDone: { en: "Save the note", he: "שמירת ההערה" },
  specsNoteRemove: { en: "Remove", he: "מחיקה" },
  specsNotesOn: { en: "Notes on", he: "מצב הערות" },
  specsNotesOff: { en: "Notes off", he: "יציאה ממצב הערות" },
  specsPage: { en: "Page", he: "עמוד" },
  remove2: { en: "Delete", he: "מחיקה" },
  signAgain: { en: "Sign again", he: "חתימה מחדש" },
  signNeedBoth: {
    en: "Choose a decision and sign, and the approval is filed onto the document.",
    he: "בוחרים החלטה, חותמים — והאישור מוטבע על המסמך."
  },
  digitalSig: { en: "Digitally signed", he: "נחתם דיגיטלית" },
  showSpecText: { en: "See the text the AI reads", he: "להציג את הטקסט שה‑AI קורא" },
  poorText: {
    en: "Could not read the file either as text or as pages.",
    he: "לא הצלחתי לקרוא את הקובץ — לא כטקסט ולא כעמודים."
  },
  readingAsImages: {
    en: "This file has no text in it — reading its pages as images instead\u2026",
    he: "אין טקסט בקובץ הזה — קורא את העמודים שלו כתמונות\u2026"
  },
  noTextTag: { en: "no text — read as images", he: "אין טקסט — ייקרא כתמונה" },
  foundProducts: { en: "Several products found in the specifications", he: "זוהו כמה מוצרים במפרטים" },
  productsHint: {
    en: "A submittal covers one product. Tick the ones to create — the first fills this form, the rest become submittals of their own, each carrying only its own pages.",
    he: "סבמיטל אחד = מוצר אחד. סמני את מה שרלוונטי — הראשון ימלא את הטופס הזה, והשאר ייווצרו כסבמיטלים נפרדים, כל אחד עם עמודי המפרט שלו בלבד."
  },
  pagesLabel: { en: "pages", he: "עמודים" },
  discard: { en: "Clear the worklist", he: "ניקוי רשימת העבודה" },
  worklist: { en: "Worklist", he: "רשימת עבודה" },
  worklistHint: {
    en: "They are waiting as a worklist. Take one at a time — it leaves the list once its submittal has been sent.",
    he: "הם ממתינים כרשימת עבודה. לוקחים אחד בכל פעם — הוא יורד מהרשימה ברגע שהסבמיטל שלו נשלח."
  },
  loadThis: { en: "Take this one", he: "לקחת את זה" },
  remaining: { en: "still to do", he: "נותרו לביצוע" },
  notRelevant: { en: "not relevant to the rest of the documents", he: "לא נמצא רלוונטי לשאר המסמכים" },
  // Two of the attached papers say different things about the same fact.
  // Nothing is chosen and nothing is hidden — she is told (30.8.26).
  conflictFound: {
    en: "The attached documents disagree — please check:",
    he: "יש סתירה בין המסמכים המצורפים — נדרשת בדיקה:"
  },
  conflictTitle: { en: "Conflicting information", he: "מידע סותר" },
  // AI suggested documents: what the package is missing, found on the official
  // sites. A recommendation is NOT part of the submittal (30.8.26, §23–28).
  suggestTitle: { en: "AI suggested documents", he: "המלצות AI למסמכים חסרים" },
  suggestHint: {
    en: "After the form is filled, the AI looks on the manufacturer's and the certifying bodies' own sites for documents this submittal does not have.",
    he: "אחרי מילוי הטופס, ה‑AI מחפש באתרי היצרן וגופי התקינה מסמכים שחסרים לסבמיטל הזה."
  },
  suggestRun: { en: "Look for missing documents", he: "חיפוש מסמכים חסרים" },
  suggestWorking: { en: "Searching the official sites…", he: "מחפש באתרים הרשמיים…" },
  suggestAfterFill: {
    en: "Fill the form first — there is nothing to search for until the product is known.",
    he: "קודם יש למלא את הטופס — אין מה לחפש לפני שידוע מהו המוצר."
  },
  suggestNone: {
    en: "Nothing official was found that the package does not already have.",
    he: "לא נמצא מסמך רשמי שאין כבר בחבילה."
  },
  suggestPage: { en: "Official page", he: "העמוד הרשמי" },
  suggestFile: { en: "Download", he: "הורדה" },
  suggestNotAttached: {
    en: "These are recommendations only. Nothing was downloaded and nothing was attached — a document becomes part of this submittal when you upload it.",
    he: "אלה המלצות בלבד. שום דבר לא הורד ולא צורף — מסמך נכנס לסבמיטל רק כשמעלים אותו."
  },
  matchExact: { en: "This exact model", he: "הדגם המדויק" },
  matchSeries: { en: "This series", he: "הסדרה" },
  matchMaker: { en: "Manufacturer general", he: "כללי של היצרן" },
  worklistDone: { en: "The worklist is finished.", he: "רשימת העבודה הושלמה." },
  olderVersions: { en: "Earlier versions", he: "גירסאות קודמות" },
  newVersionNote: {
    en: "This submittal was already sent, so editing it opens a new version.",
    he: "הסבמיטל הזה כבר נשלח, ולכן עריכה שלו פותחת גירסה חדשה."
  },
  viewOnly: { en: "View only", he: "צפייה בלבד" },
  supervision: { en: "Supervision", he: "פיקוח" },
  signAsMe: { en: "Sign", he: "לחתום" },
  clearSignature: { en: "Clear signature", he: "ניקוי חתימה" },
  noSignatureOnFile: {
    en: "No signature on file for this user — upload one in the user list.",
    he: "אין חתימה שמורה למשתמש הזה — אפשר להעלות אותה ברשימת המשתמשים."
  },
  other: { en: "Other", he: "אחר" }
};
var SB_DOC_ROWS = [
  { key: "datasheet", en: "Technical Datasheet", he: "מפרט טכני" },
  { key: "catalogue", en: "Product Catalogue", he: "קטלוג מוצר" },
  { key: "sample", en: "Sample / Material Board", he: "דוגמה / לוח חומרים" },
  { key: "shopDrawing", en: "Shop Drawing (SD)", he: "תוכנית ייצור / Shop Drawing (SD)" },
  { key: "certificates", en: "Certificates and Compliance Documents", he: "תעודות ואישורי התאמה" },
  { key: "testReports", en: "Test Reports (if applicable)", he: "דוחות בדיקה (אם רלוונטי)" },
  { key: "warranty", en: "Warranty Certificate", he: "תעודת אחריות" },
  { key: "sustainability", en: "Sustainability Documentation (EPD / HPD, if applicable)", he: "מסמכי קיימות (EPD / HPD, אם רלוונטי)" },
  { key: "installation", en: "Installation Instructions", he: "הוראות התקנה" },
  { key: "other", en: "Other", he: "אחר" }
];

// The four decisions inside every REVIEW & APPROVAL block.
var SB_DECISIONS = [
  { key: "approved", en: "Approved", he: "מאושר", color: "#1a7f4b" },
  { key: "approvedNoted", en: "Approved as Noted", he: "מאושר בכפוף להערות", color: "#2f7d8f" },
  { key: "revise", en: "Revise & Resubmit", he: "הגשה חדשה בכפוף להערות", color: "#e08a12" },
  { key: "rejected", en: "Rejected", he: "לא מאושר", color: "#d02f2f" }
];
// One approval block, the one the supervision signs. Records created when
// there were four still open: only the first block is shown and printed.
var SB_ACCENT = "#1A559E";

function sbText(entry, lang) {
  if (!entry) return "";
  return lang === "he" ? entry.he : entry.en;
}
function sbPad3(n) {
  return String(n).padStart(3, "0");
}
function sbFmtDate(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return String(iso);
  return `${parts[2]}/${parts[1]}/${String(parts[0]).slice(-2)}`;
}
// The serial is per category per project, exactly like the workbook:
// Plumbing-001, Plumbing-002 ... and the revision sits underneath it.
function sbCatCode(categoryKey) {
  const cat = SUBMITTAL_CATEGORIES.find((c) => c.key === categoryKey);
  // `code` exists so a folder can be renamed without renumbering documents that
  // already went out: the label may change, the serial prefix may not.
  return (cat ? cat.code || cat.en : categoryKey || "General").replace(/[^A-Za-z0-9]/g, "");
}
function sbNumber(categoryKey, seq) {
  return `${sbCatCode(categoryKey)}-${sbPad3(seq || 1)}`;
}
// A new revision must clear the whole family, not just the row that was
// clicked: asking for a revision of Rev.0 while Rev.1 exists has to give Rev.2.
function sbStatusOf(rec) {
  const reviews = (rec && rec.reviews) || [];
  for (let i = reviews.length - 1; i >= 0; i--) {
    if (reviews[i] && reviews[i].decision) return reviews[i].decision;
  }
  return "open";
}
function sbStatusLabel(status, lang) {
  if (status === "open") return lang === "he" ? "פתוח" : "Open";
  const d = SB_DECISIONS.find((x) => x.key === status);
  return d ? sbText(d, lang) : status;
}
function sbSignatureOf(registry, email) {
  const rec = (registry || {})[String(email || "").trim().toLowerCase()];
  return rec && rec.dataUrl || null;
}
// What actually goes on the document: the signature drawn on the approval
// itself. The old per-user library is only a fallback, for approvals filed
// before there was anything to draw on.
function sbReviewSignature(rv, registry) {
  if (rv && rv.signatureImage) return rv.signatureImage;
  return sbSignatureOf(registry, rv && rv.signedByEmail);
}
function sbPrintName(rec, lang) {
  const cat = SUBMITTAL_CATEGORIES.find((c) => c.key === rec.category) || null;
  const parts = [
    sanitizeFileNamePart(rec.projectName || ""),
    cat ? sanitizeFileNamePart(sbText(cat, lang === "en" ? "en" : "he")) : "",
    `${sbNumber(rec.category, rec.seq)} Rev.${rec.rev || 0}`,
    sbFmtDate(new Date().toISOString().slice(0, 10)).replace(/\//g, ".")
  ].filter(Boolean);
  return parts.join(" - ");
}
function sbEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
function sbBuildPrintHtml(rec, lang, brand, specPages, signatures) {
  const isHe = lang === "he";
  const dir = isHe ? "rtl" : "ltr";
  const L = (k) => sbEsc(sbText(SB_L[k], lang));
  const accent = brand && brand.accent || SB_ACCENT;
  const logo = brand && brand.logoUrl ? `<img class="logo" src="${brand.logoUrl}" alt="">` : "";
  // The same footer the contacts and user-list documents print with.
  const footImg = brand && brand.footerImg ? `<div class="footImg"><img src="${brand.footerImg}" alt=""></div>` : "";
  const footTxt = brand && brand.footerText ? `<div class="footTxt">${sbEsc(brand.footerText)}</div>` : "";
  const cat = SUBMITTAL_CATEGORIES.find((c) => c.key === rec.category);
  const val = (v) => sbEsc(v || "");
  const infoRow = (l1, v1, l2, v2) =>
    `<tr><th>${l1}</th><td>${v1}</td><th>${l2}</th><td>${v2}</td></tr>`;
  const docRows = SB_DOC_ROWS.map((r) => {
    const on = rec.docs && rec.docs[r.key];
    const extra = r.key === "other" && rec.otherText ? ` — ${sbEsc(rec.otherText)}` : "";
    return `<tr><td class="docName">${sbEsc(sbText(r, lang))}${extra}</td><td class="docBox">${on ? "&#10004;" : "&#9744;"}</td></tr>`;
  }).join("");
  // One approval block, at the very bottom, signed by the supervision.
  const rv = (rec.reviews || [])[0] || {};
  const sigImg = sbReviewSignature(rv, signatures);
  const decisions = SB_DECISIONS.map((d2) =>
    `<div class="dec"><span class="box">${rv.decision === d2.key ? "&#10004;" : "&#9744;"}</span> ${sbEsc(sbText(d2, lang))}</div>`
  ).join("");
  const reviewBlock = `<div class="revBlock"><div class="secBar">${L("review")} &nbsp;·&nbsp; ${L("supervision")}</div>
    <table class="rev"><tr>
      <td class="sig"><div class="miniLbl">${L("signature")}</div>
        <div class="sigImg">${sigImg ? `<img src="${sigImg}" alt="">` : ""}</div>
        <div class="sigVal">${sbEsc(rv.signature || "")}</div>
        ${rv.signedByEmail ? `<div class="sigStamp" dir="ltr">${L("digitalSig")} · ${sbEsc(rv.signedByEmail)} · ${sbEsc(sbFmtDate((rv.signedAt || "").slice(0, 10)))}${rv.signedAt ? ` ${sbEsc(rv.signedAt.slice(11, 16))}` : ""}</div>` : ""}</td>
      <td class="cmt"><div class="miniLbl">${L("approvalComments")}</div><div class="cmtVal">${sbEsc(rv.comments || "")}</div></td>
      <td class="decs">${decisions}</td>
    </tr></table></div>`;
  // The free-text box keeps the same size as every other value until there is
  // too much of it to fit, and then steps down inside its own area.
  const infoLen = ((isHe ? rec.infoHe : rec.infoEn) || "").length;
  const infoSize = infoLen > 2200 ? 6.5
    : infoLen > 1800 ? 7
    : infoLen > 1400 ? 7.5
    : infoLen > 1100 ? 8
    : infoLen > 900 ? 9
    : infoLen > 500 ? 10 : 11;
  const infoLead = infoLen > 1400 ? 1.25 : infoLen > 900 ? 1.32 : 1.45;
  const img = rec.image && rec.image.thumb
    ? `<img src="${rec.image.thumb}" alt="">`
    : `<span class="noImg">${L("picture")}</span>`;
  const stamp = printedStampText(lang);
  // The form is one sheet by design and the specifications are a sheet each,
  // so nothing here is paginated — but the paper is the house paper, the same
  // shell every other document is printed on (7.9.26).
  const formBody = `<div class="hdr"><div class="side">${logo}</div><div class="mid"><div class="ttl">${L("formTitle")}</div></div>
<div class="no"><b>${L("submittalNo")}</b><span>${sbEsc(sbNumber(rec.category, rec.seq))}</span><i>Rev.${sbEsc(rec.rev || 0)}</i></div></div>

<div class="secBar">${L("projectInfo")}</div>
<table class="info">
${infoRow(L("projectName"), val(rec.projectName), L("date"), sbEsc(sbFmtDate(rec.date)))}
${infoRow(L("contractor"), val(rec.contractor), L("requiredApprovalDate"), sbEsc(sbFmtDate(rec.requiredApprovalDate)))}
${infoRow(L("discipline"), sbEsc(cat ? sbText(cat, lang) : rec.discipline), L("submittedBy"), val(rec.submittedBy))}
${infoRow(L("subCategory"), sbEsc(sbSubcatLabel(rec.subCategory || rec.scope, rec.category, lang)), L("email"), val(rec.email))}
</table>

<div class="secBar">${L("equipment")}</div>
<table class="eq">
<tr><th>${L("typeId")}</th><td class="v">${val(rec.typeId)}</td><td class="pic" rowspan="4">${img}</td></tr>
<tr><th>${L("itemDescription")}</th><td class="v">${val(rec.itemDescription)}</td></tr>
<tr><th>${L("modelCode")}</th><td class="v">${val(rec.modelCode)}</td></tr>
<tr><th>${L("manufacturer")}</th><td class="v">${val(rec.manufacturer)}</td></tr>
</table>

<div class="secBar">${L("documents")}</div>
<table>${docRows}</table>

<div class="secBar">${L("additional")}</div>
<div class="addWrap">
<div class="txtBox" dir="${dir}">${sbEsc((isHe ? rec.infoHe : rec.infoEn) || "")}</div>
</div>
${reviewBlock}
<div class="ftr">${sbEsc(sbNumber(rec.category, rec.seq))} &nbsp;·&nbsp; Rev.${sbEsc(rec.rev || 0)} &nbsp;·&nbsp; ${sbEsc(sbFmtDate(rec.date))}</div>`;
  const html = `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${sbEsc(sbPrintName(rec, lang))}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&family=Inter:wght@500;600;700&display=swap');
${printSheetCss({ landscape: false, accent })}
body { font-family: 'Assistant','Inter',Arial,sans-serif; color: #1f2a37; direction: ${dir}; font-size: 9.5px; --val: 11px; }
.hdr { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid ${accent}; padding: 4px 0 12px; margin-bottom: 4px; min-height: 76px; }
/* Both sides are the same fixed width, so the title sits on the centre line of
   the page rather than on the centre of whatever the logo left over. */
.hdr .side { width: 168px; flex: 0 0 168px; display: flex; align-items: center; }
.hdr .logo { max-height: 56px; max-width: 168px; object-fit: contain; }
.hdr .mid { flex: 1; text-align: center; }
.hdr .ttl { font-size: 18px; font-weight: 800; color: ${accent}; letter-spacing: .6px; }
.hdr .no { width: 168px; flex: 0 0 168px; border: 1px solid ${accent}; border-radius: 6px; padding: 7px 10px; text-align: center; }
.hdr .no b { display: block; font-size: 9px; color: ${accent}; letter-spacing: .4px; }
.hdr .no span { font-size: 12px; font-weight: 800; }
.hdr .no i { display: block; font-style: normal; font-size: 9px; color: #6b7280; }
.secBar { background: ${accent}; color: #fff; text-align: center; font-weight: 700; font-size: 9.5px; letter-spacing: .5px; padding: 2px 0; margin: 7px 0 0; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #cfd6e0; padding: 0 6px; vertical-align: middle; }
/* One uniform row height across the whole document. The equipment rows are
   exactly two of them, because that is where the text actually lands. */
.info th, .info td, tbody .docName, tbody .docBox { height: 17px; }
.info th { background: #f3f6fa; font-weight: 700; width: 17%; white-space: nowrap; text-align: ${isHe ? "right" : "left"}; }
.info td { width: 33%; text-align: center; font-size: var(--val); }
.eq { table-layout: fixed; }
.eq th, .eq td.v { height: 36px; }
.eq th { background: #f3f6fa; font-weight: 700; width: 26%; text-align: ${isHe ? "right" : "left"}; }
.eq td.v { width: 38%; text-align: center; font-size: var(--val); }
.eq td.pic { width: 36%; text-align: center; padding: 3px; }
.eq td.pic img { max-width: 100%; max-height: 130px; object-fit: contain; }
.noImg { color: #9aa3af; font-size: 9px; }
.docName { text-align: ${isHe ? "right" : "left"}; font-size: var(--val); }
.docBox { width: 34px; text-align: center; font-size: 12px; }
.addWrap { flex: 1; display: flex; flex-direction: column; min-height: 96px; }
.txtBox { flex: 1; border: 1px solid #cfd6e0; padding: 6px 8px; min-height: 96px; max-height: 150px; overflow: hidden;
  white-space: pre-wrap; font-size: ${infoSize}px; line-height: ${infoLead}; }
.miniLbl { font-size: 10px; color: #6b7280; font-weight: 700; margin-bottom: 3px; }
.rev td { vertical-align: top; height: 112px; padding: 7px 9px; font-size: var(--val); }
.rev .sig { width: 30%; }
.rev .cmt { width: 42%; }
.rev .decs { width: 28%; }
.sigImg { height: 74px; display: flex; align-items: center; justify-content: center; }
.sigImg img { max-height: 72px; max-width: 100%; object-fit: contain; }
.sigVal { font-size: 11px; font-weight: 600; color: #374151; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 4px; margin-top: 4px; }
.sigStamp { font-size: 8px; font-weight: 600; color: #6b7280; text-align: center; margin-top: 2px; letter-spacing: .2px; }
.dec { display: flex; align-items: center; gap: 7px; font-size: 11px; padding: 2px 0; }
.dec .box { font-size: 13px; }
.revBlock { flex: 0 0 auto; }
.footTxt { font-size: 9px; color: #6b7280; text-align: center; white-space: pre-line; margin-bottom: 5px; }
.ftr { margin-top: 5px; font-size: 8px; color: #9aa3af; text-align: center; flex: 0 0 auto; }
/* The attached specifications, appended after the form — one source page per
   printed sheet, inside the same frame, so the whole thing reads as a single
   document. */
.specWrap { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.specWrap .specLbl { font-size: 8px; color: #6b7280; margin-bottom: 4px; direction: ltr; text-align: center; }
.specWrap img { max-width: 100%; max-height: calc(100% - 14px); object-fit: contain; }
</style></head><body>${printStaticPage(formBody, {
    flow: true,
    stamp,
    footHtml: `${footTxt}${footImg}`
  })}${(specPages || []).map((sp) => printStaticPage(
    `<div class="specWrap"><div class="specLbl">${sbEsc(sp.label)}</div><img src="${sp.dataUrl}" alt=""></div>`,
    { stamp }
  )).join("")}</body></html>`;
  return html;
}
// Render every attached PDF to images, so the printed document is the submittal
// on page one and the specifications it refers to on the pages after it.
// Nothing is stored: the combined document is built at the moment it is asked
// for and lives only in the print window.
function sbPrint(rec, lang, brand, signatures) {
  const w = window.open("", "_blank");
  if (!w) {
    window.alert(lang === "he"
      ? "\u05d4\u05d3\u05e4\u05d3\u05e4\u05df \u05d7\u05e1\u05dd \u05d0\u05ea \u05d7\u05dc\u05d5\u05df \u05d4\u05de\u05e1\u05de\u05da. \u05d9\u05e9 \u05dc\u05d0\u05e4\u05e9\u05e8 \u05d7\u05dc\u05d5\u05e0\u05d5\u05ea \u05e7\u05d5\u05e4\u05e6\u05d9\u05dd \u05dc\u05d0\u05ea\u05e8 \u05d5\u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1."
      : "The browser blocked the document window. Allow pop-ups for this site and try again.");
    return;
  }
  const waiting = lang === "he" ? "\u05de\u05db\u05d9\u05df \u05d0\u05ea \u05d4\u05de\u05e1\u05de\u05da\u2026" : "Preparing the document\u2026";
  w.document.open();
  w.document.write(`<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;padding:60px;text-align:center;color:#6b7280"><p id="sbmsg">${sbEsc(waiting)}</p></body></html>`);
  w.document.close();
  (async () => {
    let specPages = [];
    try {
      specPages = await sbRenderSpecPages(rec, (n) => {
        try {
          const el = w.document.getElementById("sbmsg");
          if (el) el.textContent = `${waiting} (${n})`;
        } catch (e) {
        }
      });
    } catch (e) {
      console.warn("[awdash] spec rendering failed", e);
    }
    // Anything written on the specifications is drawn into the pages before
    // they are placed, so the printed document says what the screen said.
    try {
      specPages = await sbBurnSpecNotes(specPages, rec.specNotes);
    } catch (e) {
      console.warn("[awdash] could not draw the notes onto the specs", e);
    }
    if (w.closed) return;
    const html = sbBuildPrintHtml(rec, lang, brand, specPages, signatures);
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      try {
        w.print();
      } catch (e) {
      }
    }, specPages.length ? 1200 : 700);
  })();
}

// ------------------------------------------------------------------- the form
function sbIsClosed(rec) {
  if (!rec) return false;
  if (rec.closedAt) return true;
  // Records approved before the closing rule existed: a decision that was
  // signed is just as final.
  const rv = (rec.reviews || [])[0] || {};
  return !!(rv.decision && rv.signedAt);
}
function sbSpecNoteList(notes, page) {
  return (notes || []).filter((n) => n && n.page === page);
}
// The notes, drawn into the page images themselves, so the printed document
// carries them without the print builder needing to know they exist. Canvas
// rather than pdf-lib for the same reason the drawing board uses canvas: the
// browser already shapes and lays out Hebrew, and pdf-lib does not.
async function sbBurnSpecNotes(pages, notes) {
  const list = notes || [];
  if (!list.length) return pages;
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const mine = sbSpecNoteList(list, i);
    if (!mine.length) { out.push(pages[i]); continue; }
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = pages[i].dataUrl;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const unit = Math.max(11, Math.round(c.width / 62));
      ctx.textBaseline = "top";
      ctx.direction = "rtl";
      mine.forEach((n) => {
        const text = String(n.text || "").trim();
        if (!text) return;
        ctx.font = `600 ${unit}px Assistant, Arial, sans-serif`;
        const maxW = Math.round(c.width * 0.34);
        // Wrap by words, the way the box on screen wraps.
        const words = text.split(/\s+/);
        const lines = [];
        let line = "";
        words.forEach((w) => {
          const t = line ? `${line} ${w}` : w;
          if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
          else line = t;
        });
        if (line) lines.push(line);
        const padX = Math.round(unit * 0.7);
        const padY = Math.round(unit * 0.5);
        const lh = Math.round(unit * 1.35);
        const boxW = Math.min(maxW, Math.max.apply(null, lines.map((l) => ctx.measureText(l).width))) + padX * 2;
        const boxH = lines.length * lh + padY * 2;
        let x = Math.round(n.x * c.width);
        let y = Math.round(n.y * c.height);
        x = Math.max(4, Math.min(x, c.width - boxW - 4));
        y = Math.max(4, Math.min(y, c.height - boxH - 4));
        ctx.fillStyle = "rgba(255, 249, 219, .95)";
        ctx.strokeStyle = "#14265e";
        ctx.lineWidth = Math.max(1, Math.round(unit / 9));
        ctx.beginPath();
        const r = Math.round(unit * 0.35);
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
        ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
        ctx.arcTo(x, y + boxH, x, y, r);
        ctx.arcTo(x, y, x + boxW, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#14181f";
        lines.forEach((l, k) => ctx.fillText(l, x + boxW - padX, y + padY + k * lh));
        // Who wrote it, small, under the note.
        if (n.by) {
          ctx.font = `600 ${Math.round(unit * 0.7)}px Assistant, Arial, sans-serif`;
          ctx.fillStyle = "#6b7280";
          ctx.fillText(n.by, x + boxW - padX, y + boxH + Math.round(unit * 0.15));
        }
      });
      out.push({ ...pages[i], dataUrl: c.toDataURL("image/jpeg", 0.82) });
    } catch (e) {
      console.warn("[awdash] could not draw a note onto a spec page", e);
      out.push(pages[i]);
    }
  }
  return out;
}
function SubmittalSpecs({ rec, lang, isRTL, notes, canNote, onChangeNotes, currentEmail, onClose }) {
  const L = (k) => sbText(SB_L[k] || { en: k, he: k }, lang);
  const [pages, setPages] = useState6(null);
  const [noteMode, setNoteMode] = useState6(false);
  const [editing, setEditing] = useState6(null);
  const [text, setText] = useState6("");

  useEffect5(() => {
    let alive = true;
    (async () => {
      let p = [];
      try {
        p = await sbRenderSpecPages(rec, null);
      } catch (e) {
        console.warn("[awdash] could not open the specifications", e);
      }
      if (alive) setPages(p);
    })();
    return () => { alive = false; };
  }, [rec && rec.id]);

  const put = (next) => { if (onChangeNotes) onChangeNotes(next); };
  const place = (e, page) => {
    if (!noteMode || !canNote) return;
    const r = e.currentTarget.getBoundingClientRect();
    setEditing({
      id: `n-${Date.now()}`,
      page,
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height
    });
    setText("");
  };
  const keep = () => {
    const t = String(text || "").trim();
    if (!t || !editing) { setEditing(null); return; }
    put([...(notes || []), { ...editing, text: t, by: (currentEmail || "").split("@")[0] || "", at: new Date().toISOString() }]);
    setEditing(null);
    setText("");
  };
  const drop = (id) => put((notes || []).filter((n) => n.id !== id));

  return createPortal(
    sbH(
      "div",
      { className: "sbSpecsScrim", dir: isRTL ? "rtl" : "ltr" },
      sbH(
        "div",
        { className: "sbSpecsView" },
        sbH(
          "div",
          { className: "sbSpecsBar" },
          sbH("span", { className: "sbSpecsBarTitle" }, L("specsView")),
          canNote
            ? sbH(
                "button",
                { type: "button", className: `sgGhost small ${noteMode ? "on" : ""}`.trim(), onClick: () => { setNoteMode(!noteMode); setEditing(null); } },
                sbH(PenLine, { size: 14, strokeWidth: 2 }),
                " ",
                noteMode ? L("specsNotesOff") : L("specsNotesOn")
              )
            : null,
          sbH("span", { style: { flex: 1 } }),
          sbH(
            "button",
            { type: "button", className: "sgClose", onClick: onClose, "aria-label": L("close") || "X" },
            sbH(X4, { size: 16, strokeWidth: 2 })
          )
        ),
        canNote && noteMode ? sbH("p", { className: "sbSpecsHint" }, L("specsNoteHint")) : null,
        sbH(
          "div",
          { className: "sbSpecsScroll" },
          pages === null
            ? sbH("p", { className: "sbSpecsMsg" }, L("specsLoading"))
            : pages.length === 0
              ? sbH("p", { className: "sbSpecsMsg" }, L("specsNone"))
              : pages.map((p, i) =>
                  sbH(
                    "div",
                    { key: i, className: "sbSpecsPageWrap" },
                    sbH("div", { className: "sbSpecsLbl", dir: "ltr" }, p.label),
                    sbH(
                      "div",
                      {
                        className: `sbSpecsPage ${noteMode && canNote ? "noting" : ""}`.trim(),
                        onClick: (e) => place(e, i)
                      },
                      sbH("img", { src: p.dataUrl, alt: "" }),
                      sbSpecNoteList(notes, i).map((n) =>
                        sbH(
                          "div",
                          {
                            key: n.id,
                            className: "sbSpecsNote",
                            style: { insetInlineStart: `${n.x * 100}%`, top: `${n.y * 100}%` },
                            onClick: (e) => e.stopPropagation()
                          },
                          sbH("div", { className: "sbSpecsNoteTxt", dir: "auto" }, n.text),
                          n.by ? sbH("div", { className: "sbSpecsNoteBy" }, n.by) : null,
                          canNote
                            ? sbH(
                                "button",
                                { type: "button", className: "sbSpecsNoteDel", title: L("specsNoteRemove"), onClick: () => drop(n.id) },
                                sbH(X4, { size: 11, strokeWidth: 2.4 })
                              )
                            : null
                        )
                      ),
                      editing && editing.page === i
                        ? sbH(
                            "div",
                            {
                              className: "sbSpecsNote editing",
                              style: { insetInlineStart: `${editing.x * 100}%`, top: `${editing.y * 100}%` },
                              onClick: (e) => e.stopPropagation()
                            },
                            sbH("textarea", {
                              value: text,
                              rows: 3,
                              autoFocus: true,
                              dir: "auto",
                              onChange: (e) => setText(e.target.value)
                            }),
                            sbH(
                              "div",
                              { className: "sbSpecsNoteRow" },
                              sbH("button", { type: "button", className: "sbLinkBtn muted", onClick: () => setEditing(null) }, L("specsNoteRemove")),
                              sbH("button", { type: "button", className: "sgBtn", onClick: keep }, L("specsNoteDone"))
                            )
                          )
                        : null
                    )
                  )
                )
        )
      )
    ),
    document.body
  );
}

// src/components/SignaturePad.jsx
// -----------------------------------------------------------------------------
// A box to sign in, with a mouse or a finger. Pointer events cover both, so
// there is no separate touch path to keep working. What comes out is a PNG with
// a transparent background, trimmed to the ink, so it drops onto the form the
// way a stamp would.
// -----------------------------------------------------------------------------
function SignaturePad({ isRTL, onCancel, onDone }) {
  const canvasRef = useRef5(null);
  const stampRef = useRef5(null);
  const [dirty, setDirty] = useState6(false);
  // A company stamp, uploaded, sitting under the pen. On paper the stamp goes
  // down first and the signature is written across it; the pad works the same
  // way, and what is saved is the two of them as one image (7.9.26).
  const [stamp, setStamp] = useState6(null);
  const t = (he, en) => (isRTL ? he : en);
  const onStampFile = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setStamp(String(rd.result || ""));
    rd.readAsDataURL(f);
  };

  useEffect5(() => {
    const c = canvasRef.current;
    if (!c) return;
    // Draw at the device's own resolution, or the line looks like a staircase
    // on a phone and the saved image comes out soft.
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#14181f";
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    c.__drawing = true;
    setDirty(true);
    // Capture keeps the stroke alive if the pointer wanders off the box, but a
    // browser that refuses the call must not take the whole stroke with it.
    try {
      if (e.pointerId != null && c.setPointerCapture) c.setPointerCapture(e.pointerId);
    } catch (err) {
      // no capture; drawing still works while the pointer is over the canvas
    }
  };
  const move = (e) => {
    const c = canvasRef.current;
    if (!c || !c.__drawing) return;
    e.preventDefault();
    const ctx = c.getContext("2d");
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = (e) => {
    const c = canvasRef.current;
    if (!c) return;
    c.__drawing = false;
    if (e && e.pointerId != null && c.hasPointerCapture && c.hasPointerCapture(e.pointerId)) {
      c.releasePointerCapture(e.pointerId);
    }
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setDirty(false);
  };
  // Crop to the ink before saving: a signature drawn in the corner should not
  // arrive on the form as a mostly-empty rectangle.
  const done = () => {
    const c = canvasRef.current;
    // Flatten first: the stamp as the eye sees it in the box, then the ink over
    // it. Everything after this measures the picture that will actually be
    // filed, so a signature written across a stamp is trimmed as one mark.
    const flat = document.createElement("canvas");
    flat.width = c.width;
    flat.height = c.height;
    const fx = flat.getContext("2d");
    const st = stampRef.current;
    if (st && st.naturalWidth) {
      const rect = c.getBoundingClientRect();
      const ratio = c.width / (rect.width || 1);
      const inset = 6;
      const boxW = Math.max(1, rect.width - inset * 2);
      const boxH = Math.max(1, rect.height - inset * 2);
      const s = Math.min(boxW / st.naturalWidth, boxH / st.naturalHeight);
      const w = st.naturalWidth * s;
      const h = st.naturalHeight * s;
      fx.drawImage(st, (inset + (boxW - w) / 2) * ratio, (inset + (boxH - h) / 2) * ratio, w * ratio, h * ratio);
    }
    fx.drawImage(c, 0, 0);
    const ctx = flat.getContext("2d");
    const img = ctx.getImageData(0, 0, c.width, c.height);
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (img.data[(y * c.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return;
    const pad = Math.round(6 * (window.devicePixelRatio || 1));
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(c.width - 1, maxX + pad); maxY = Math.min(c.height - 1, maxY + pad);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(flat, minX, minY, w, h, 0, 0, w, h);
    // PNG, not JPEG: the background has to stay transparent.
    onDone(out.toDataURL("image/png"));
  };

  // Straight onto the body. The whole app sits inside a scaled box, and
  // `position: fixed` inside a transformed ancestor anchors to that box, not to
  // the window — the pad came out above the top of the screen. Outside .appRoot
  // it inherits neither direction nor font, so both are set here.
  return createPortal(
    sbH(
      "div",
      { className: "sigPadScrim", onClick: onCancel, dir: isRTL ? "rtl" : "ltr" },
      sbH(
        "div",
        { className: "sigPad", onClick: (e) => e.stopPropagation(), dir: isRTL ? "rtl" : "ltr" },
        sbH("div", { className: "sigPadTitle" }, t("חתימה", "Signature")),
        sbH("p", { className: "sigPadHint" },
          stamp
            ? t("חתמי על גבי החותמת — בעכבר או באצבע.", "Sign over the stamp — with a mouse or a finger.")
            : t("חתמי בתוך המסגרת — בעכבר או באצבע. אפשר גם להעלות חותמת ולחתום עליה.",
                "Sign inside the frame — with a mouse or a finger. You can also upload a stamp and sign over it.")),
        sbH(
          "div",
          { className: "sigStage" },
          stamp ? sbH("img", { ref: stampRef, className: "sigStampImg", src: stamp, alt: "" }) : null,
          sbH("canvas", {
            ref: canvasRef,
            className: "sigCanvas",
            onPointerDown: start,
            onPointerMove: move,
            onPointerUp: end,
            onPointerLeave: end,
            onPointerCancel: end
          })
        ),
        sbH(
          "div",
          { className: "sigStampRow" },
          sbH(
            "label",
            { className: "sgGhost small", style: { cursor: "pointer", fontFamily: "inherit" } },
            sbH(Upload3, { size: 14, strokeWidth: 2 }),
            " ",
            stamp ? t("החלפת חותמת", "Replace stamp") : t("העלאת חותמת", "Upload a stamp"),
            sbH("input", { type: "file", accept: "image/*", style: { display: "none" }, onChange: onStampFile })
          ),
          stamp
            ? sbH("button", { type: "button", className: "sbLinkBtn muted", onClick: () => setStamp(null) }, t("הסרת החותמת", "Remove the stamp"))
            : null
        ),
        sbH(
          "div",
          { className: "sigPadRow" },
          sbH("button", { type: "button", className: "sbLinkBtn muted", onClick: clear }, t("ניקוי", "Clear")),
          sbH("span", { style: { flex: 1 } }),
          sbH("button", { type: "button", className: "sgGhost small", onClick: onCancel }, t("ביטול", "Cancel")),
          sbH(
            "button",
            { type: "button", className: "sgBtn", disabled: !dirty && !stamp, onClick: done },
            t("אישור החתימה", "Confirm signature")
          )
        )
      )
    ),
    document.body
  );
}

// src/cards/SubmittalReview.jsx
// -----------------------------------------------------------------------------
// What a client or the main contractor sees when they open a submittal: the
// document exactly as it prints, on screen, and underneath it the decision and
// a place to sign. They never see the editing form — there is nothing here for
// them to change.
// -----------------------------------------------------------------------------
function sbPagesOf(att, numPages) {
  const list = att && att.pageList;
  if (!Array.isArray(list) || !list.length) {
    return Array.from({ length: numPages }, (_, i) => i + 1);
  }
  return list.map(Number).filter((n) => n >= 1 && n <= numPages).sort((a, b) => a - b);
}async function sbRenderSpecPages(rec, onProgress) {
  const atts = (rec.attachments || []).filter((a) => !a.type || String(a.type).indexOf("pdf") >= 0);
  if (!atts.length) return [];
  let pdfjsLib;
  try {
    pdfjsLib = await loadPdfJs();
  } catch (e) {
    console.warn("[awdash] no PDF.js, printing without the specs", e);
    return [];
  }
  const out = [];
  for (const att of atts) {
    if (out.length >= SB_PRINT_PAGE_CAP) break;
    let buf = null;
    try {
      if (att.inline && att.dataUrl) {
        buf = await (await fetch(att.dataUrl)).arrayBuffer();
      } else if (att.path) {
        const { data, error } = await supabase.storage.from(SUBMITTAL_BUCKET).download(att.path);
        if (error) throw error;
        buf = await data.arrayBuffer();
      }
    } catch (e) {
      console.warn("[awdash] could not fetch a spec for printing", att.name, e);
      continue;
    }
    if (!buf) continue;
    try {
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const wanted = sbPagesOf(att, doc.numPages);
      for (const i of wanted) {
        if (out.length >= SB_PRINT_PAGE_CAP) break;
        const page = await doc.getPage(i);
        // ~150 DPI against A4 width: readable in print without a huge payload.
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1240 / base.width, 3);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        out.push({
          // The file name is ours, not the reader's. "SPEC-REV3-FINAL-v2.pdf"
          // on a printed page says nothing about the product and everything
          // about how the folder is kept. The submittal number, the revision
          // and the page are what identify the sheet. (7.9.26)
          label: `${sbNumber(rec.category, rec.seq)} Rev.${rec.rev || 0} · p.${i}/${doc.numPages}`,
          dataUrl: canvas.toDataURL("image/jpeg", 0.8)
        });
        if (onProgress) onProgress(out.length);
      }
    } catch (e) {
      console.warn("[awdash] could not render a spec for printing", att.name, e);
    }
  }
  return out;
}

// Some specifications carry no text at all — every page is a picture (a scan,
// or a PDF printed by a tool that rasterises everything). There is nothing to
// extract, so the pages themselves are sent and the model reads them by eye.
// Deliberately smaller and fewer than the print render: legible is enough.

function PrintLangAsk({ onPick, onClose, withAudience }) {
  // Two questions on the boards, one everywhere else. The audience decides
  // which columns are printed: a client's copy carries what a client sees on
  // the screen, and hers carries everything (29.8.26).
  const [lang, setLang] = useState6("he");
  const [who, setWho] = useState6("admin");
  const pick = (v) => (withAudience ? onPick(v, who) : onPick(v));
  return createPortal(
    sbH(
      "div",
      { className: "printAskScrim", onClick: onClose },
      sbH(
        "div",
        { className: "printAskBox", dir: "rtl", onClick: (e) => e.stopPropagation() },
        sbH("h3", null, "הדפסה"),
        withAudience
          ? sbH(
              React15.Fragment,
              null,
              sbH("p", null, "עבור מי המסמך?"),
              sbH(
                "div",
                { className: "printAskBtns" },
                sbH("button", {
                  type: "button",
                  className: `printAskChoice ${who === "admin" ? "on" : ""}`,
                  onClick: () => setWho("admin")
                }, "הדפסת מנהל · כל העמודות"),
                sbH("button", {
                  type: "button",
                  className: `printAskChoice ${who === "client" ? "on" : ""}`,
                  onClick: () => setWho("client")
                }, "הדפסת לקוח · העמודות שהלקוח רואה")
              )
            )
          : null,
        sbH("p", null, "באיזו שפה להפיק את המסמך?"),
        sbH("p", { className: "printAskEn", dir: "ltr" }, "Which language should the document be produced in?"),
        sbH(
          "div",
          { className: "printAskBtns" },
          // The window that actually prints is opened inside this click, so the
          // browser still counts it as a gesture and does not block the popup.
          sbH("button", { type: "button", className: "sgBtn", onClick: () => pick("he") }, "עברית"),
          sbH("button", { type: "button", className: "sgBtn", onClick: () => pick("en") }, "English")
        ),
        sbH("button", { type: "button", className: "sbLinkBtn printAskCancel", onClick: onClose }, "ביטול · Cancel")
      )
    ),
    document.body
  );
}

function SubmittalReview({ rec, lang, isRTL, langSwitch, canSign, printBrand, userSignatures, currentEmail, specNotes, onChangeSpecNotes, onSave, onCancel }) {
  const L = (k) => sbText(SB_L[k], lang);
  const [printAsk, setPrintAsk] = useState6(null);
  const [d, setD] = useState6(rec);
  const [padOpen, setPadOpen] = useState6(false);
  const [specsOpen, setSpecsOpen] = useState6(false);
  const specCount = (rec && rec.attachments || []).filter((a) => !a.type || String(a.type).indexOf("pdf") >= 0).length;
  useEffect5(() => { setD(rec); }, [rec && rec.id]);

  const inS = {
    padding: "7px 9px",
    border: "1px solid var(--line)",
    borderRadius: 7,
    fontSize: 13,
    background: "#fff",
    width: "100%",
    fontFamily: "inherit",
    color: "inherit"
  };
  const rv = (d.reviews || [])[0] || {};
  const setReview = (patch) => {
    const next = (d.reviews || []).slice();
    next[0] = { ...rv, ...patch };
    setD({ ...d, reviews: next });
  };
  // The document is rebuilt from the record on every change, so the moment a
  // decision is ticked or a signature is drawn it is visible in the page above.
  const docHtml = sbBuildPrintHtml(d, lang, printBrand, [], userSignatures).replace(
    "</head>",
    "<style>@media screen{body{display:flex;justify-content:center;background:#f6f6f7}}</style></head>"
  );
  const signed = !!(rv.signatureImage || rv.signedByEmail);
  // Read from the record as it was handed to us, never from the working copy:
  // signing sets a date, and judging the copy would make the page consider
  // itself closed the instant the pen came off the pad — before the decision
  // had been filed at all.
  const closed = sbIsClosed(rec);
  // What each decision asks for before it can be filed. A rejection is a
  // statement, not a negotiation: it is recorded and the document closes.
  const needsComment = rv.decision === "approvedNoted" || rv.decision === "revise";
  const needsSignature = !!rv.decision && rv.decision !== "rejected";
  const commentOk = !needsComment || String(rv.comments || "").trim().length > 0;
  const ready = !!rv.decision && commentOk && (!needsSignature || signed);

  const applySignature = (dataUrl) => {
    setPadOpen(false);
    const who = (currentEmail || "").split("@")[0] || currentEmail || "";
    setReview({
      signatureImage: dataUrl,
      signedByEmail: (currentEmail || "").toLowerCase(),
      signature: rv.signature || who,
      signedAt: new Date().toISOString()
    });
  };
  // Filing closes the document. From here it can be printed and nothing else —
  // an approval that can be quietly changed afterwards is not an approval.
  const file = () => onSave({ ...d, closedAt: new Date().toISOString() });

  const head = sbH(
    "div",
    { className: "sbFormHead" },
    sbH(
      "div",
      { className: "sbFormHeadSide start" },
      sbH(
        "button",
        { type: "button", className: "sgBack", onClick: onCancel },
        sbH(isRTL ? ArrowRight : ArrowLeft, { size: 14, strokeWidth: 2.4 }),
        " ",
        L("back")
      )
    ),
    sbH(
      "div",
      { className: "sbNoBox" },
      sbH("b", null, L("submittalNo")),
      sbH("span", null, sbNumber(d.category, d.seq)),
      sbH("i", null, `Rev.${d.rev || 0}`)
    ),
    sbH(
      "div",
      { className: "sbFormHeadSide end" },
      langSwitch || null,
      // The specifications, as pages. The question an approver has is almost
      // never about the form — it is about page four of the datasheet, and
      // until now there was no way to look at it here, let alone say anything
      // about it (7.9.26).
      specCount
        ? sbH(
            "button",
            { type: "button", className: "sgGhost small", onClick: () => setSpecsOpen(true) },
            sbH(FileTextIcon, { size: 14, strokeWidth: 2 }),
            " ",
            L("specsView"),
            sbH("span", { className: "sbSpecsCount" }, specCount)
          )
        : null,
      sbH(
        "button",
        { type: "button", className: "sgGhost small", title: L("pdfHint"), onClick: () => setPrintAsk(() => (lg) => sbPrint(d, lg, printBrand, userSignatures)) },
        sbH(Printer, { size: 14, strokeWidth: 2 }),
        " ",
        L("print")
      ),
      printAsk ? sbH(PrintLangAsk, { onPick: (lg) => { setPrintAsk(null); printAsk(lg); }, onClose: () => setPrintAsk(null) }) : null
    )
  );

  return sbH(
    "div",
    { className: "sbReviewPage", dir: isRTL ? "rtl" : "ltr" },
    head,
    // The document itself. An iframe because it is the very same HTML that goes
    // to the printer — one source, so what is signed on screen and what comes
    // out of the printer cannot drift apart.
    sbH("iframe", { className: "sbDocFrame", title: sbPrintName(d), srcDoc: docHtml }),

    closed
      ? sbH(
          "div",
          { className: "sbClosedBar" },
          sbH(Stamp, { size: 16, strokeWidth: 2 }),
          " ",
          sbH("span", null, `${L("closedOn")} ${sbFmtDate((d.closedAt || rv.signedAt || "").slice(0, 10))} · ${sbStatusLabel(sbStatusOf(d), lang)}`),
          sbH("span", { className: "sbClosedNote" }, L("closedNote"))
        )
      : canSign
        ? sbH(
            "div",
            { className: "sbSignPanel" },
            sbH("div", { className: "sbSecBar" }, `${L("review")} · ${L("supervision")}`),
            sbH(
              "div",
              { className: "sbDecisions sbDecRowWide" },
              SB_DECISIONS.map((dec) =>
                sbH(
                  "label",
                  { key: dec.key, className: "sbDecRow" },
                  sbH("input", {
                    type: "radio",
                    name: `sb-rev-${d.id}`,
                    checked: rv.decision === dec.key,
                    onChange: () => setReview({ decision: dec.key })
                  }),
                  sbH("span", { style: { color: dec.color, fontWeight: 700 } }, sbText(dec, lang))
                )
              )
            ),
            // The comment box appears for the two decisions that are answers to
            // something: "as noted" and "resubmit" both mean there is a note,
            // and a note nobody wrote helps nobody.
            needsComment
              ? sbH(
                  "label",
                  { className: "sbField" },
                  sbH("span", { className: "sbFieldLbl" }, `${L("approvalComments")} — ${L("required")}`),
                  sbH("textarea", {
                    value: rv.comments || "",
                    rows: 3,
                    autoFocus: true,
                    placeholder: L("commentsPlaceholder"),
                    onChange: (e) => setReview({ comments: e.target.value }),
                    style: { ...inS, resize: "vertical" }
                  })
                )
              : null,
            needsSignature
              ? sbH(
                  "div",
                  { className: "sbSignRow" },
                  signed
                    ? sbH(
                        "div",
                        { className: "sbSignedBox" },
                        rv.signatureImage ? sbH("img", { src: rv.signatureImage, alt: "" }) : null,
                        sbH(
                          "div",
                          { className: "sbSignedMeta", dir: "ltr" },
                          sbH("span", null, rv.signedByEmail || ""),
                          sbH("span", null, rv.signedAt ? `${sbFmtDate(rv.signedAt.slice(0, 10))} ${rv.signedAt.slice(11, 16)}` : "")
                        ),
                        sbH(
                          "button",
                          {
                            type: "button",
                            className: "sbLinkBtn muted",
                            onClick: () => setReview({ signatureImage: null, signedByEmail: null, signature: "", signedAt: null })
                          },
                          L("clearSignature")
                        )
                      )
                    : null,
                  sbH(
                    "button",
                    { type: "button", className: "sbSignBtn", onClick: () => setPadOpen(true) },
                    sbH(PenLine, { size: 15, strokeWidth: 2 }),
                    " ",
                    signed ? L("signAgain") : L("signHere")
                  )
                )
              : null,
            sbH(
              "div",
              { className: "sbSaveRow" },
              sbH(
                "button",
                { type: "button", className: "sgBtn", disabled: !ready, onClick: file },
                L("fileDecision")
              )
            ),
            sbH(
              "p",
              { className: "sbSignHint" },
              !rv.decision
                ? L("pickDecision")
                : !commentOk
                  ? L("needComment")
                  : needsSignature && !signed
                    ? L("needSignature")
                    : L("filingCloses")
            )
          )
        : null,
    padOpen
      ? sbH(SignaturePad, { isRTL, onCancel: () => setPadOpen(false), onDone: applySignature })
      : null,
    specsOpen
      ? sbH(SubmittalSpecs, {
          rec: d, lang, isRTL,
          notes: specNotes || [],
          // Writing on the specifications is part of reviewing them. Once the
          // decision is filed the document is closed, and so are the notes.
          canNote: !!canSign && !closed && !!onChangeSpecNotes,
          onChangeNotes: onChangeSpecNotes,
          currentEmail,
          onClose: () => setSpecsOpen(false)
        })
      : null
  );
}



// ---------------------------------------------------------------------------
//  Moved here 15.9.2026 (build 168) from index.html.
//
//  The supervision page has to offer a supervisor the same signing the site
//  offers the client, and for a drawing that means this screen: the marks on
//  the plan, the stamp, the pen, and the burn into a new PDF. It lived in the
//  dashboard, so only the dashboard could show it. It lives here now, and the
//  dashboard imports it back — one copy, two pages, same as the submittal
//  review above it.
//
//  The five general helpers below (fileToDataUrl, boardFileName, sbToday,
//  sbFileUrl, sbClipboardImage) came with it for the same reason: this screen
//  needs them and the dashboard already imports this file.
// ---------------------------------------------------------------------------

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function boardFileName(projectName, docName, ext) {
  const day = new Date();
  const stamp = `${String(day.getDate()).padStart(2, "0")}.${String(day.getMonth() + 1).padStart(2, "0")}.${String(day.getFullYear()).slice(2)}`;
  const parts = [sanitizeFileNamePart(projectName || "Project"), docName, stamp].filter(Boolean);
  return `${parts.join(" - ")}${ext ? `.${ext}` : ""}`;
}

function sbToday() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function sbFileUrl(att) {
  if (!att) return null;
  if (att.inline && att.dataUrl) return dataUrlToBlobUrl(att.dataUrl, att.name) || att.dataUrl;
  if (!att.path) return null;
  try {
    // Downloaded and handed over as a blob with the right content type, rather
    // than as a signed link. A file stored before the content type was being
    // set — and every file she uploaded until yesterday is one — is served as
    // "application/octet-stream", and a browser downloads that instead of
    // showing it, whatever the link says. Reading the bytes ourselves settles
    // it for old files and new ones alike (29.8.26).
    const { data, error } = await supabase.storage.from(SUBMITTAL_BUCKET).download(att.path);
    if (error) throw error;
    const type = (data && data.type && data.type !== "application/octet-stream")
      ? data.type
      : guessContentType(att.name || att.path);
    return URL.createObjectURL(new Blob([await data.arrayBuffer()], { type }));
  } catch (e) {
    console.warn("[awdash] could not read the file for viewing; falling back to a link", e);
    try {
      const { data, error } = await supabase.storage.from(SUBMITTAL_BUCKET).createSignedUrl(att.path, 3600);
      if (error) throw error;
      return data && data.signedUrl || null;
    } catch (e2) {
      return null;
    }
  }
}

function sbClipboardImage(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === "file" && /^image\//.test(items[i].type || "")) {
      const f = items[i].getAsFile();
      if (f) return f;
    }
  }
  const fs = (e.clipboardData && e.clipboardData.files) || [];
  if (fs.length && /^image\//.test(fs[0].type || "")) return fs[0];
  return null;
}

function dataUrlToBlobUrl(dataUrl, name) {
  const m = String(dataUrl || "").match(/^data:([^;,]*)(;base64)?,(.*)$/);
  if (!m) return null;
  const type = m[1] || guessContentType(name);
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], { type: type || "application/octet-stream" }));
  } catch (e) {
    return null;
  }
}

function guessContentType(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

function sdStatus(key) {
  return SD_STATUSES.find((s) => s.key === key) || SD_STATUSES[0];
}

var CONTENT_TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", txt: "text/plain",
  csv: "text/csv", xml: "application/xml", html: "text/html",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

var SD_STATUSES = [
  { key: "required", en: "Required", he: "נדרש", color: "#9aa3af" },
  { key: "drafting", en: "In preparation", he: "בהכנה", color: "#3a7bd5" },
  { key: "submitted", en: "Submitted", he: "הוגש", color: "#7a5cd6" },
  { key: "approvedNoted", en: "Approved as noted", he: "מאושר בכפוף להערות", color: "#e08a12" },
  { key: "approved", en: "Approved", he: "מאושר", color: "#1a7f4b" },
  { key: "revise", en: "Resubmit", he: "הגשה מחדש", color: "#c0392b" }
];

// pdf-lib burns the marks into a new file. Same three sources as pdf.js, same
// reason: one CDN having a bad afternoon must not stop her signing a drawing.
var PDFLIB_VERSION = "1.17.1";
var PDFLIB_SOURCES = [
  `https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/${PDFLIB_VERSION}/pdf-lib.min.js`,
  `https://cdn.jsdelivr.net/npm/pdf-lib@${PDFLIB_VERSION}/dist/pdf-lib.min.js`,
  `https://unpkg.com/pdf-lib@${PDFLIB_VERSION}/dist/pdf-lib.min.js`
];
var sdPdfLibLoading = null;
async function loadPdfLib() {
  if (typeof window !== "undefined" && window.PDFLib) return window.PDFLib;
  if (sdPdfLibLoading) return sdPdfLibLoading;
  sdPdfLibLoading = (async () => {
    let lastErr = null;
    for (const src of PDFLIB_SOURCES) {
      try {
        await loadScriptOnce(src);
        if (!window.PDFLib) throw new Error("PDFLib not defined after script load");
        return window.PDFLib;
      } catch (e) {
        lastErr = e;
        console.error("pdf-lib source failed:", src, e);
      }
    }
    sdPdfLibLoading = null;
    throw lastErr || new Error("pdf-lib failed to load");
  })();
  return sdPdfLibLoading;
}

var SDC_L = {
  title: { en: "Shop drawings for approval", he: "תוכניות ייצור לאישור" },
  lead: {
    en: "Open a drawing to download it or to sign it.",
    he: "פתיחה מאפשרת הורדה או חתימה."
  },
  boq: { en: "BOQ", he: "BOQ" },
  category: { en: "Category", he: "קטגוריה" },
  desc: { en: "Description", he: "תיאור" },
  dueAt: { en: "Approval due", he: "תאריך יעד לאישור" },
  submittedAt: { en: "Submitted", he: "תאריך הגשה" },
  file: { en: "File", he: "קובץ" },
  status: { en: "Status", he: "סטטוס" },
  approvedAt: { en: "Approved on", he: "תאריך אישור" },
  open: { en: "Open", he: "פתיחה" },
  empty: {
    en: "No drawing has been issued for your approval yet.",
    he: "עדיין לא הוגשה תוכנית לאישורכם."
  },
  // the dialog
  askTitle: { en: "What would you like to do?", he: "מה תרצו לעשות?" },
  download: { en: "Download the file", he: "הורדת הקובץ" },
  sign: { en: "Sign", he: "חתימה" },
  cancel: { en: "Cancel", he: "ביטול" },
  approvedAlready: { en: "Signed and approved", he: "נחתם ואושר" },
  viewSigned: { en: "Open the signed file", he: "פתיחת הקובץ החתום" },
  // the signing screen
  noteTool: { en: "Handwritten note", he: "חתימה ידנית" },
  noteDone: { en: "Finish notes", he: "סיום" },
  stampTool: { en: "Stamp", he: "חותמת" },
  finish: { en: "Approve and finish", he: "אישור וסיום" },
  close: { en: "Close", he: "סגירה" },
  placeHint: {
    en: "Click anywhere on the drawing to place a note. Add as many as you need, then press Finish.",
    he: "לחיצה על התוכנית ממקמת תיבת טקסט. אפשר להוסיף כמה שצריך, ואז ללחוץ סיום."
  },
  stampHint: { en: "Drag the stamp into place and set its size.", he: "גוררים את החותמת למקום ומכווננים את הגודל." },
  stampPick: {
    en: "Click to choose an image, or press Ctrl+V to paste one.",
    he: "לחיצה לבחירת קובץ, או Ctrl+V להדבקת תמונה."
  },
  next: { en: "Next", he: "הבא" },
  drawHead: { en: "Sign over the stamp", he: "חתימה על גבי החותמת" },
  drawHint: {
    en: "Draw your signature over the stamp with the mouse or your finger.",
    he: "מציירים את החתימה על גבי החותמת עם העכבר או האצבע."
  },
  clearDraw: { en: "Clear", he: "ניקוי" },
  doneDraw: { en: "Finish", he: "סיום" },
  size: { en: "Size", he: "גודל" },
  remove: { en: "Remove", he: "הסרה" },
  loading: { en: "Loading the drawing…", he: "טוען את התוכנית…" },
  burning: { en: "Writing the signed file…", he: "כותב את הקובץ החתום…" },
  confirmTitle: { en: "Approve this drawing?", he: "לאשר את התוכנית?" },
  confirmBody: {
    en: "A new signed file is created and the drawing is marked approved. This cannot be undone from here.",
    he: "ייווצר קובץ חתום חדש והתוכנית תסומן כמאושרת. לא ניתן לבטל את זה מכאן."
  },
  confirmYes: { en: "Approve", he: "אישור" },
  nothingToSign: {
    en: "Add a note or a stamp before approving.",
    he: "יש להוסיף הערה או חותמת לפני האישור."
  },
  failed: { en: "The signed file could not be saved. Nothing was changed.", he: "לא הצלחתי לשמור את הקובץ החתום. שום דבר לא השתנה." },
  noPdf: { en: "Only a PDF can be signed here. Use Download for this file.", he: "אפשר לחתום כאן על PDF בלבד. עבור הקובץ הזה יש להשתמש בהורדה." }
};

// An approval, once made, is the whole story of the row as far as the client is
// concerned: when, by whom, and which file carries the marks.
// A description is a sentence; a file name is not. Slashes and quotes are
// taken out, runs of space collapsed, and the whole thing capped — a name that
// is 200 characters long is unusable in every mail client there is.
function sdFileLabel(text) {
  const clean = String(text || "").replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "SD";
  return clean.length > 60 ? `${clean.slice(0, 60).trim()}…` : clean;
}
function sdApprovalOf(approvals, code) {
  return (approvals || {})[code] || null;
}
// Green, and "approved", is driven by the approval record — not by the status
// the administrator set. The two can differ for a moment while a save is in
// flight, and the client should see their own action immediately.
function sdClientStatus(row, approval, lang) {
  if (approval) return { key: "approved", label: lang === "he" ? "אושר" : "Approved", color: "#1a7f4b" };
  const st = sdStatus((row || {}).status);
  return { key: st.key, label: lang === "he" ? st.he : st.en, color: st.color };
}

// ---- geometry ---------------------------------------------------------------
// Every mark is stored in PDF points against the page it sits on, with the
// origin at the TOP-left — the same way the screen thinks. Storing screen
// pixels instead would move every mark the first time somebody signs on a
// different sized window; points are what the printed page is measured in, so
// what is placed is what is burned.
function sdMarkBlank(kind, page, xPt, yPt) {
  return {
    id: `k-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    kind, page,
    x: xPt, y: yPt,
    w: kind === "note" ? 170 : 130,
    h: kind === "note" ? 44 : 60,
    text: "",
    dataUrl: null,
    locked: false
  };
}
// A note is drawn to a small transparent PNG and that PNG is embedded.
//
// The alternative — asking pdf-lib to draw the text — needs a font embedded
// with Hebrew glyphs and a right-to-left shaper, which is a large dependency to
// carry for a sentence. The browser already draws Hebrew correctly, so it draws
// it once into a canvas and the canvas goes into the page. The drawing itself
// stays vector; only the note is a picture, and it is a picture of exactly what
// she saw on screen.
var SD_NOTE_PAD = 4;
var SD_NOTE_FONT = 11;
var SD_NOTE_LINE = 1.35;
var SD_NOTE_STAMP_FONT = 8;
function sdWrapText(ctx, text, maxW) {
  const out = [];
  String(text || "").split("\n").forEach((para) => {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); return; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width <= maxW) line = next;
      else { out.push(line); line = words[i]; }
    }
    out.push(line);
  });
  return out;
}
// Height in points, for a note of this width holding this text. The screen and
// the burned page both ask this, so neither can drift from the other.
function sdNoteHeight(text, wPt, stampLine) {
  const c = document.createElement("canvas").getContext("2d");
  c.font = `${SD_NOTE_FONT}px Assistant, Arial, sans-serif`;
  const lines = sdWrapText(c, text, Math.max(10, wPt - SD_NOTE_PAD * 2));
  const body = Math.max(1, lines.length) * SD_NOTE_FONT * SD_NOTE_LINE;
  const stamp = stampLine ? SD_NOTE_STAMP_FONT * 1.5 + 3 : 0;
  return Math.ceil(body + stamp + SD_NOTE_PAD * 2);
}
function sdNoteToPng(mark, stampLine, scale) {
  const s = scale || 4;
  const wPt = mark.w;
  const hPt = sdNoteHeight(mark.text, wPt, stampLine);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(wPt * s);
  canvas.height = Math.ceil(hPt * s);
  const ctx = canvas.getContext("2d");
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(0, 0, wPt, hPt);
  // navy, 2pt, drawn inside the box so nothing is clipped
  ctx.strokeStyle = "#10275a";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0.7, 0.7, wPt - 1.4, hPt - 1.4);
  ctx.direction = /[֐-׿]/.test(String(mark.text || "") + String(stampLine || "")) ? "rtl" : "ltr";
  // Centred, because that is how the box reads on screen. The two must agree:
  // the burned page is meant to be a picture of exactly what she saw. (7.9.26)
  const startX = wPt / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#10275a";
  ctx.font = `${SD_NOTE_FONT}px Assistant, Arial, sans-serif`;
  const lines = sdWrapText(ctx, mark.text, Math.max(10, wPt - SD_NOTE_PAD * 2));
  let y = SD_NOTE_PAD;
  lines.forEach((ln) => {
    ctx.fillText(ln, startX, y);
    y += SD_NOTE_FONT * SD_NOTE_LINE;
  });
  if (stampLine) {
    ctx.strokeStyle = "#c8d0dc";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(SD_NOTE_PAD, y + 1.5);
    ctx.lineTo(wPt - SD_NOTE_PAD, y + 1.5);
    ctx.stroke();
    ctx.fillStyle = "#4a5a72";
    ctx.font = `${SD_NOTE_STAMP_FONT}px Assistant, Arial, sans-serif`;
    ctx.fillText(stampLine, startX, y + 4);
  }
  return { dataUrl: canvas.toDataURL("image/png"), wPt, hPt };
}

// The one function that turns marks into a file. Kept apart from the screen so
// it can be run on its own — the screen is hard to test, this is not.
async function sdBurnMarks(pdfBytes, marks, stampLine) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  const embedPng = async (dataUrl) => doc.embedPng(dataUrl);
  for (const mark of marks) {
    const page = pages[mark.page - 1];
    if (!page) continue;
    const pageH = page.getSize().height;
    if (mark.kind === "note") {
      if (!String(mark.text || "").trim()) continue;
      const shot = sdNoteToPng(mark, stampLine);
      const img = await embedPng(shot.dataUrl);
      page.drawImage(img, {
        x: mark.x,
        // The page counts from the bottom; the screen counts from the top.
        y: pageH - mark.y - shot.hPt,
        width: shot.wPt,
        height: shot.hPt
      });
    } else if (mark.kind === "stamp" && mark.dataUrl) {
      const img = /^data:image\/png/i.test(mark.dataUrl)
        ? await doc.embedPng(mark.dataUrl)
        : await doc.embedJpg(mark.dataUrl);
      page.drawImage(img, { x: mark.x, y: pageH - mark.y - mark.h, width: mark.w, height: mark.h });
    }
  }
  return doc.save();
}

// -----------------------------------------------------------------------------
// The signing screen.
// -----------------------------------------------------------------------------
function SdSignScreen({ lang, isRTL, L, file, title, who, projectName, docLabel, onCancel, onDone }) {
  const [doc, setDoc] = useState6(null);
  const [pages, setPages] = useState6([]);       // { num, wPt, hPt }
  const [bytes, setBytes] = useState6(null);
  const [scale, setScale] = useState6(1);
  const [marks, setMarks] = useState6([]);
  const [noteMode, setNoteMode] = useState6(false);
  const [stampStep, setStampStep] = useState6(null);   // null | "pick"
  const [stampImg, setStampImg] = useState6(null);
  const drawRef = useRef5(null);
  const inkRef = useRef5(false);
  const [sel, setSel] = useState6(null);
  const [busy, setBusy] = useState6(null);
  const [err, setErr] = useState6(null);
  const [ask, setAsk] = useState6(false);
  const wrapRef = useRef5(null);
  const dragRef = useRef5(null);
  const pageRefs = useRef5({});

  const stampLine = `${sbFmtDate(sbToday())} · ${who || ""}`.trim();

  // ---- load ----------------------------------------------------------------
  useEffect5(() => {
    let dead = false;
    (async () => {
      setBusy(L("loading"));
      setErr(null);
      try {
        const url = await sbFileUrl(file);
        if (!url) throw new Error("no url");
        const raw = new Uint8Array(await (await fetch(url)).arrayBuffer());
        if (dead) return;
        setBytes(raw);
        // pdf.js takes ownership of the buffer it is handed, so it gets a copy
        // and the original stays intact for pdf-lib to burn later.
        const pdfjsLib = await loadPdfJs();
        const loaded = await pdfjsLib.getDocument({ data: raw.slice() }).promise;
        if (dead) return;
        const list = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const p = await loaded.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          list.push({ num: i, wPt: vp.width, hPt: vp.height });
        }
        if (dead) return;
        setDoc(loaded);
        setPages(list);
        // Fit the widest page to the panel, and never blow a small page up
        // past its own size.
        const avail = (wrapRef.current ? wrapRef.current.clientWidth : 900) - 48;
        const widest = Math.max(...list.map((p) => p.wPt), 1);
        setScale(Math.max(0.3, Math.min(1.6, avail / widest)));
        setBusy(null);
      } catch (e) {
        if (dead) return;
        console.error("[awdash] sd sign: could not open the drawing", e);
        setErr(String((e && e.message) || e));
        setBusy(null);
      }
    })();
    return () => { dead = true; };
  }, [file && (file.path || file.dataUrl)]);

  // ---- placing -------------------------------------------------------------
  const pageClick = (pageNum, e) => {
    if (!noteMode) return;
    if (e.target.closest && e.target.closest(".sdMark")) return;
    const box = e.currentTarget.getBoundingClientRect();
    const xPt = (e.clientX - box.left) / scale;
    const yPt = (e.clientY - box.top) / scale;
    const m = sdMarkBlank("note", pageNum, Math.max(0, xPt), Math.max(0, yPt));
    setMarks((prev) => prev.concat(m));
    setSel(m.id);
  };
  const patchMark = (id, next) => setMarks((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)));
  const dropMark = (id) => {
    setMarks((prev) => prev.filter((m) => m.id !== id));
    setSel((s) => (s === id ? null : s));
  };
  // Dragging is done on the pointer, not on HTML5 drag-and-drop: a drag image
  // over a canvas is a ghost of the whole page, and the drop coordinates come
  // back wrong on a scrolled panel.
  const startDrag = (id, e) => {
    e.preventDefault();
    e.stopPropagation();
    const m = marks.find((x) => x.id === id);
    if (!m) return;
    const host = pageRefs.current[m.page];
    const box = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    dragRef.current = {
      id, page: m.page,
      rectX: box.left, rectY: box.top,
      // Where inside the mark she took hold of it, so it does not jump under
      // the cursor on the first pixel of movement.
      grabX: e.clientX - box.left - m.x * scale,
      grabY: e.clientY - box.top - m.y * scale
    };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      // A mark dragged over another page belongs to that page. Without this a
      // stamp can be dropped anywhere on screen and still be burned onto the
      // page it started on — which is how a signature ends up on the wrong
      // sheet of a drawing set. (7.9.26)
      let page = d.page;
      let originX = d.rectX;
      let originY = d.rectY;
      Object.keys(pageRefs.current).forEach((num) => {
        const el = pageRefs.current[num];
        if (!el) return;
        const box = el.getBoundingClientRect();
        if (ev.clientX >= box.left && ev.clientX <= box.right && ev.clientY >= box.top && ev.clientY <= box.bottom) {
          page = Number(num);
          originX = box.left;
          originY = box.top;
        }
      });
      patchMark(d.id, {
        page,
        x: Math.max(0, (ev.clientX - originX - d.grabX) / scale),
        y: Math.max(0, (ev.clientY - originY - d.grabY) / scale)
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const finishNotes = () => {
    setNoteMode(false);
    // Empty boxes are not notes; they are clicks in the wrong place.
    setMarks((prev) => prev
      .filter((m) => m.kind !== "note" || String(m.text || "").trim())
      .map((m) => (m.kind === "note" ? { ...m, locked: true } : m)));
  };

  const takeStampFile = async (f) => {
    if (!f || !/^image\//.test(f.type || "")) return;
    setStampImg(await fileToDataUrl(f));
  };
  // Which page is she actually looking at. A stamp always dropped on page one
  // is wrong for anything but a one-page drawing, and a forty-page set is the
  // normal case here. The page filling the middle of the panel is the page she
  // means. (7.9.26)
  const pageInView = () => {
    const wrap = wrapRef.current;
    if (!wrap) return 1;
    const mid = wrap.getBoundingClientRect().top + wrap.clientHeight / 2;
    let best = 1, bestGap = Infinity;
    Object.keys(pageRefs.current).forEach((num) => {
      const el = pageRefs.current[num];
      if (!el) return;
      const box = el.getBoundingClientRect();
      const gap = mid < box.top ? box.top - mid : mid > box.bottom ? mid - box.bottom : 0;
      if (gap < bestGap) { bestGap = gap; best = Number(num); }
    });
    return best;
  };
  // A scanned stamp and a signature drawn over it are one image by the time
  // they reach the drawing: flattened here, so what is placed, what is dragged
  // and what is burned are all the same picture. (7.9.26)
  const flattenStamp = () => new Promise((resolve) => {
    const canvas = drawRef.current;
    const img = new Image();
    img.onload = () => {
      if (!canvas) { resolve(stampImg); return; }
      const out = document.createElement("canvas");
      out.width = img.width;
      out.height = img.height;
      const ctx = out.getContext("2d");
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
      resolve(out.toDataURL("image/png"));
    };
    img.onerror = () => resolve(stampImg);
    img.src = stampImg;
  });
  const startInk = (e) => {
    const canvas = drawRef.current;
    if (!canvas) return;
    e.preventDefault();
    inkRef.current = true;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#10275a";
    ctx.lineWidth = Math.max(2, canvas.width / 220);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const at = (ev) => {
      const b = canvas.getBoundingClientRect();
      return [(ev.clientX - b.left) * canvas.width / b.width, (ev.clientY - b.top) * canvas.height / b.height];
    };
    ctx.moveTo(...at(e));
    const move = (ev) => { if (!inkRef.current) return; ctx.lineTo(...at(ev)); ctx.stroke(); };
    const up = () => {
      inkRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const clearInk = () => {
    const c = drawRef.current;
    if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
  };
  const fitInk = (imgEl) => {
    const c = drawRef.current;
    if (!c || !imgEl) return;
    c.width = imgEl.naturalWidth || imgEl.clientWidth;
    c.height = imgEl.naturalHeight || imgEl.clientHeight;
  };
  const placeStamp = async () => {
    if (!stampImg) return;
    const flat = await flattenStamp();
    const img = new Image();
    img.onload = () => {
      const num = pageInView();
      const pg = pages.find((x) => x.num === num) || pages[0] || { wPt: 600, hPt: 800 };
      const w = Math.min(140, pg.wPt / 4);
      const h = w * (img.height / img.width || 0.6);
      const m = {
        ...sdMarkBlank("stamp", num, pg.wPt - w - 40, pg.hPt - h - 40),
        w, h, dataUrl: flat, locked: true
      };
      setMarks((prev) => prev.concat(m));
      setSel(m.id);
      setStampStep(null);
      setStampImg(null);
    };
    img.src = flat;
  };
  const resizeStamp = (id, w) => {
    const m = marks.find((x) => x.id === id);
    if (!m) return;
    const ratio = m.h / m.w;
    patchMark(id, { w, h: w * ratio });
  };

  // ---- finish --------------------------------------------------------------
  const usable = marks.filter((m) => (m.kind === "note" ? String(m.text || "").trim() : !!m.dataUrl));
  const doFinish = async () => {
    setAsk(false);
    setBusy(L("burning"));
    setErr(null);
    try {
      const out = await sdBurnMarks(bytes, usable, stampLine);
      // The same shape as every other document the site produces:
      // <project> - <what it is> - <date>. boardFileName owns that rule, so a
      // signed drawing is named the way an exported board is. (7.9.26)
      const name = boardFileName(projectName, docLabel || title || "Signed", "pdf");
      const signed = new File([out], name, { type: "application/pdf" });
      await onDone(signed, usable.length);
    } catch (e) {
      console.error("[awdash] sd sign: burning failed", e);
      setErr(L("failed"));
      setBusy(null);
    }
  };

  // ---- render --------------------------------------------------------------
  const markEl = (m) => {
    const common = {
      key: m.id,
      style: {
        left: m.x * scale,
        top: m.y * scale,
        width: m.w * scale
      }
    };
    if (m.kind === "stamp") {
      return sbH(
        "div",
        {
          ...common,
          className: `sdMark ${sel === m.id ? "sel" : ""}`.trim(),
          style: { ...common.style, height: m.h * scale },
          onPointerDown: () => setSel(m.id)
        },
        sbH("img", { src: m.dataUrl, alt: "" }),
        sbH("button", { type: "button", className: "sdMoveBtn", onPointerDown: (e) => startDrag(m.id, e), title: L("size") },
          sbH(MoveSd, { size: 12, strokeWidth: 2.2 })),
        sbH("button", { type: "button", className: "sdMarkBtn", title: L("remove"), onClick: () => dropMark(m.id) }, "×")
      );
    }
    const h = sdNoteHeight(m.text, m.w, m.locked ? stampLine : "") * scale;
    return sbH(
      "div",
      {
        ...common,
        className: `sdMark sdNote ${m.locked ? "locked" : "draft"}`,
        style: { ...common.style, minHeight: h, fontSize: SD_NOTE_FONT * scale },
        onPointerDown: () => setSel(m.id)
      },
      m.locked
        ? sbH(
            "div",
            null,
            sbH("div", { className: "sdNoteText", style: { lineHeight: SD_NOTE_LINE } }, m.text),
            sbH("div", { className: "sdNoteStamp", style: { fontSize: SD_NOTE_STAMP_FONT * scale } }, stampLine)
          )
        : sbH("textarea", {
            autoFocus: sel === m.id,
            rows: 2,
            value: m.text,
            style: { fontSize: SD_NOTE_FONT * scale, lineHeight: SD_NOTE_LINE },
            onChange: (e) => patchMark(m.id, { text: e.target.value }),
            onPointerDown: (e) => e.stopPropagation()
          }),
      sbH("button", { type: "button", className: "sdMoveBtn", onPointerDown: (e) => startDrag(m.id, e) },
        sbH(MoveSd, { size: 12, strokeWidth: 2.2 })),
      sbH("button", { type: "button", className: "sdMarkBtn", title: L("remove"), onClick: () => dropMark(m.id) }, "×")
    );
  };

  const selMark = marks.find((m) => m.id === sel && m.kind === "stamp");

  return createPortal(
    sbH(
    "div",
    { className: "sdSign", dir: isRTL ? "rtl" : "ltr" },
    sbH(
      "div",
      { className: "sdSignBar" },
      sbH("span", { className: "sdSignName" }, title),
      sbH(
        "button",
        {
          type: "button",
          className: `sdSignBtn ${noteMode ? "on" : ""}`.trim(),
          onClick: () => (noteMode ? finishNotes() : setNoteMode(true))
        },
        sbH(PenLineSd, { size: 14, strokeWidth: 2.2 }), " ", noteMode ? L("noteDone") : L("noteTool")
      ),
      sbH("button", { type: "button", className: "sdSignBtn", onClick: () => { setNoteMode(false); setStampStep("pick"); } },
        sbH(StampSd, { size: 14, strokeWidth: 2.2 }), " ", L("stampTool")),
      selMark
        ? sbH(
            "span",
            { className: "sdSizeRow" },
            sbH("span", { className: "sdSignHint" }, L("size")),
            sbH("input", {
              type: "range", min: 40, max: 400, value: Math.round(selMark.w),
              onChange: (e) => resizeStamp(selMark.id, Number(e.target.value))
            })
          )
        : sbH("span", { className: "sdSignHint" }, noteMode ? L("placeHint") : ""),
      sbH("button", { type: "button", className: "sdSignBtn go", disabled: !usable.length || !!busy, onClick: () => setAsk(true) },
        sbH(CheckSd, { size: 14, strokeWidth: 2.4 }), " ", L("finish")),
      sbH("button", { type: "button", className: "sdSignBtn", onClick: onCancel },
        sbH(XSd, { size: 14, strokeWidth: 2.2 }), " ", L("close"))
    ),

    err ? sbH("div", { style: { padding: "10px 14px" } }, sbH("div", { className: "sdSignErr" }, err)) : null,

    sbH(
      "div",
      { className: "sdSignScroll", ref: wrapRef },
      pages.map((p) => sbH(
        "div",
        {
          key: p.num,
          className: `sdSignPage ${noteMode ? "placing" : ""}`.trim(),
          "data-page": p.num,
          ref: (el) => { pageRefs.current[p.num] = el; },
          style: { width: p.wPt * scale, height: p.hPt * scale },
          onClick: (e) => pageClick(p.num, e)
        },
        sbH(SdPageCanvas, { doc, num: p.num, wPt: p.wPt, hPt: p.hPt, scale }),
        marks.filter((m) => m.page === p.num).map(markEl)
      ))
    ),

    busy ? sbH("div", { className: "sdSignBusy" }, busy) : null,

    stampStep === "pick"
      ? sbH(
          "div",
          { className: "sdcAsk", onClick: () => setStampStep(null) },
          sbH(
            "div",
            { className: "sdcAskBox", onClick: (e) => e.stopPropagation() },
            sbH("h3", { className: "sdcAskTitle" }, L("stampTool")),
            sbH("p", { className: "sdcAskName" }, L("stampPick")),
            sbH(
              "div",
              {
                className: `sdStampPad ${stampImg ? "on" : ""}`.trim(),
                tabIndex: 0,
                onPaste: (e) => { const f = sbClipboardImage(e); if (f) { e.preventDefault(); takeStampFile(f); } },
                onClick: (e) => { const i = e.currentTarget.querySelector("input"); if (i) i.click(); }
              },
              stampImg ? sbH("img", { src: stampImg, alt: "" }) : sbH("span", null, L("stampPick")),
              sbH("input", {
                type: "file", accept: "image/*", style: { display: "none" },
                onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; takeStampFile(f); }
              })
            ),
            sbH(
              "div",
              { style: { display: "flex", gap: 8, marginTop: 14 } },
              sbH("button", { type: "button", className: "sdcAskBtn primary", disabled: !stampImg, onClick: () => setStampStep("draw") },
                L("next"), " ", sbH(isRTL ? ArrowLeftSd : ArrowRightSd, { size: 14, strokeWidth: 2.2 })),
              sbH("button", { type: "button", className: "sdcAskBtn", onClick: () => { setStampStep(null); setStampImg(null); } }, L("cancel"))
            )
          )
        )
      : null,

    stampStep === "draw"
      ? sbH(
          "div",
          { className: "sdcAsk" },
          sbH(
            "div",
            { className: "sdcAskBox", onClick: (e) => e.stopPropagation(), style: { maxWidth: 560 } },
            sbH("h3", { className: "sdcAskTitle" }, L("drawHead")),
            sbH("p", { className: "sdcAskName" }, L("drawHint")),
            sbH(
              "div",
              { className: "sdDrawWrap" },
              sbH("img", { src: stampImg, alt: "", onLoad: (e) => fitInk(e.currentTarget) }),
              sbH("canvas", { ref: drawRef, onPointerDown: startInk })
            ),
            sbH(
              "div",
              { style: { display: "flex", gap: 8, marginTop: 14 } },
              sbH("button", { type: "button", className: "sdcAskBtn primary", onClick: placeStamp },
                sbH(CheckSd, { size: 15, strokeWidth: 2.4 }), " ", L("doneDraw")),
              sbH("button", { type: "button", className: "sdcAskBtn", onClick: clearInk }, L("clearDraw")),
              sbH("button", { type: "button", className: "sdcAskBtn", onClick: () => { setStampStep("pick"); } }, L("cancel"))
            )
          )
        )
      : null,

    ask
      ? sbH(
          "div",
          { className: "sdcAsk", onClick: () => setAsk(false) },
          sbH(
            "div",
            { className: "sdcAskBox", onClick: (e) => e.stopPropagation() },
            sbH("h3", { className: "sdcAskTitle" }, L("confirmTitle")),
            sbH("p", { className: "sdcAskName" }, L("confirmBody")),
            sbH(
              "div",
              { className: "sdcAskRow" },
              sbH("button", { type: "button", className: "sdcAskBtn primary", onClick: doFinish },
                sbH(CheckSd, { size: 15, strokeWidth: 2.4 }), " ", L("confirmYes")),
              sbH("button", { type: "button", className: "sdcAskBtn", onClick: () => setAsk(false) }, L("cancel"))
            )
          )
        )
      : null
    ),
    document.body
  );
}

// One page, drawn once. Its own component so that adding a note does not make
// pdf.js redraw every page of a forty-page drawing set.
function SdPageCanvas({ doc, num, wPt, hPt, scale }) {
  const ref = useRef5(null);
  useEffect5(() => {
    if (!doc || !ref.current) return;
    let dead = false;
    doc.getPage(num).then((page) => {
      if (dead || !ref.current) return;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = ref.current;
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = `${wPt * scale}px`;
      canvas.style.height = `${hPt * scale}px`;
      page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
    }).catch((e) => console.error("[awdash] sd page render failed", e));
    return () => { dead = true; };
  }, [doc, num, scale]);
  return sbH("canvas", { ref });
}

// ---------------------------------------------------------------------------
//  signCss — the look of this screen, in the file that holds the screen.
//
//  Until 15.9.2026 these rules lived in the dashboard's pdfViewer stylesheet,
//  which the supervision page does not load: the component travelled to
//  sign.js and its appearance stayed behind. Both pages now take it from this
//  one string — the dashboard appends signCss to its styles array, the
//  supervision page puts it in a <style> of its own.
//
//  Nine of these classes — sbField, sbFieldLbl, sbFormHead, sbFormHeadSide,
//  sbLinkBtn, sbNoBox, sbSaveRow, sbSecBar, sbSpecsCount — are also rendered
//  by the dashboard's own submittal form. That is why the dashboard must LOAD
//  signCss and not merely stop defining them.
//
//  It asks the page it lands on for six tokens and the font:
//      --ink  --steel  --mist  --line  --accent  --surface
//      body { font-family: 'Assistant', ... }
// ---------------------------------------------------------------------------
var signCss = `
        .printAskChoice {
          border: 1px solid var(--line); background: #fff; color: var(--steel);
          border-radius: 10px; padding: 9px 12px; font-family: inherit;
          font-size: 12.5px; font-weight: 700; cursor: pointer;
        }
        .printAskChoice.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
        /* ---------- the reviewer's page ---------- */
        /* The page is a flex item with auto inline margins, so it shrinks to fit
           its content — and an iframe has almost no intrinsic width. A definite
           width in design pixels gives the document room to be read. */
        .sbReviewPage { width: 1180px; max-width: 100%; margin: 0 auto; }
        .sbDocFrame {
          display: block; width: 100%; height: 1140px; border: 1px solid var(--line);
          border-radius: 10px; background: #fff; margin-top: 10px;
        }
        .sbSignPanel {
          margin-top: 16px; border: 1px solid var(--line); border-radius: 10px;
          overflow: hidden; background: #fff;
        }
        .sbSignPanel .sbSecBar { margin: 0; }
        .sbSignPanel .sbField, .sbSignPanel .sbDecisions, .sbSignRow, .sbSignPanel .sbSaveRow { padding: 0 14px; }
        .sbSignPanel .sbDecisions { padding-top: 12px; }
        .sbSignPanel .sbField { margin-top: 10px; }
        .sbDecRowWide {
          display: flex; flex-direction: row; gap: 22px; flex-wrap: wrap;
          justify-content: center; align-items: center; text-align: center;
        }
        .sbDecRowWide .sbDecRow { justify-content: center; }
        .sbSignRow {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
          justify-content: center; margin-top: 14px;
        }
        .sbSignBtn {
          display: inline-flex; align-items: center; gap: 7px; background: #14181f;
          border: 1px solid #14181f; color: #fff; border-radius: 10px; padding: 10px 20px;
          cursor: pointer; font-family: inherit; font-size: 13.5px; font-weight: 800;
        }
        .sbSignBtn:hover { background: #232a35; }
        .sbSignedBox {
          display: flex; align-items: center; gap: 10px; border: 1px solid var(--line);
          border-radius: 10px; padding: 8px 12px; background: #fbfcfd;
        }
        .sbSignedBox img { height: 46px; max-width: 190px; object-fit: contain; }
        .sbSignedMeta { display: flex; flex-direction: column; font-size: 11px; font-weight: 700; color: var(--mist); }
        .sbClosedBar {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          margin-top: 16px; padding: 12px 16px; border: 1px solid #cfe3d6;
          border-radius: 10px; background: #f2faf5; color: #14532d;
          font-size: 13px; font-weight: 800;
        }
        .sbClosedNote { font-weight: 600; color: var(--steel); }
        .sbSignHint { text-align: center; font-size: 12px; color: var(--mist); margin: 0 0 14px; }
        .sbSignPanel .sbSaveRow { padding-bottom: 14px; }
        /* ---------- the specifications, on screen ---------- */
        .sbSpecsScrim {
          position: fixed; inset: 0; z-index: 1180; background: rgba(16,18,22,.6);
          display: flex; align-items: stretch; justify-content: center; padding: 18px;
          font-family: 'Assistant', 'Inter', sans-serif;
        }
        .sbSpecsView {
          background: #fff; border-radius: 14px; width: min(1040px, 100%);
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 18px 60px rgba(0,0,0,.3);
        }
        .sbSpecsBar {
          display: flex; align-items: center; gap: 10px; padding: 12px 14px;
          border-bottom: 1px solid var(--line); flex: 0 0 auto;
        }
        .sbSpecsBarTitle { font-size: 14.5px; font-weight: 800; color: var(--ink); }
        .sbSpecsCount {
          display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px;
          margin-inline-start: 6px; padding: 0 4px; border-radius: 999px; background: var(--accent);
          color: #fff; font-size: 10.5px; font-weight: 800;
        }
        .sbSpecsBar .sgGhost.on { background: var(--accent); color: #fff; border-color: var(--accent); }
        .sbSpecsHint { margin: 0; padding: 8px 14px; font-size: 12.5px; color: var(--mist); background: #fbfcfd; border-bottom: 1px solid var(--line); }
        .sbSpecsScroll { flex: 1 1 auto; overflow: auto; padding: 14px; background: #eef1f5; }
        .sbSpecsMsg { text-align: center; color: var(--mist); font-size: 13px; padding: 40px 0; }
        .sbSpecsPageWrap { max-width: 820px; margin: 0 auto 18px; }
        .sbSpecsLbl { font-size: 10.5px; color: var(--mist); text-align: center; margin-bottom: 5px; }
        .sbSpecsPage { position: relative; background: #fff; box-shadow: 0 2px 12px -6px rgba(0,0,0,.4); }
        .sbSpecsPage img { display: block; width: 100%; height: auto; }
        .sbSpecsPage.noting { cursor: crosshair; }
        /* A note is anchored by its top-inline-start corner, which is the point
           that was clicked — so it reads from the click outwards in both
           directions. */
        .sbSpecsNote {
          position: absolute; max-width: 34%; min-width: 120px;
          background: rgba(255,249,219,.97); border: 1.5px solid var(--accent);
          border-radius: 7px; padding: 6px 8px; font-size: 12px; line-height: 1.35;
          box-shadow: 0 3px 10px -4px rgba(0,0,0,.35);
        }
        .sbSpecsNoteTxt { white-space: pre-wrap; word-break: break-word; }
        .sbSpecsNoteBy { font-size: 10px; color: var(--mist); font-weight: 700; margin-top: 3px; }
        .sbSpecsNoteDel {
          position: absolute; top: -8px; inset-inline-end: -8px; width: 18px; height: 18px;
          border-radius: 999px; border: 1px solid var(--line); background: #fff; color: #c0392b;
          cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;
        }
        .sbSpecsNote.editing { min-width: 210px; }
        .sbSpecsNote.editing textarea {
          width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 6px 7px;
          font-family: inherit; font-size: 12.5px; resize: vertical; background: #fff;
        }
        .sbSpecsNoteRow { display: flex; align-items: center; gap: 8px; margin-top: 6px; justify-content: space-between; }
        .sbSpecsNoteRow .sgBtn { padding: 5px 12px; font-size: 12px; }
        /* ---------- the pad ---------- */
        .sigPadScrim {
          position: fixed; inset: 0; z-index: 1200; background: rgba(16,18,22,.55);
          display: flex; align-items: center; justify-content: center; padding: 20px;
          font-family: 'Assistant', 'Inter', sans-serif;
        }
        .sigPad {
          background: #fff; border-radius: 14px; padding: 18px 20px 16px;
          width: min(560px, 100%); box-shadow: 0 18px 60px rgba(0,0,0,.28);
          font-family: 'Assistant', 'Inter', sans-serif;
        }
        .sigPadTitle { font-size: 15px; font-weight: 800; color: var(--ink); }
        .sigPadHint { margin: 4px 0 12px; font-size: 12.5px; color: var(--mist); }
        /* The pad is two layers: an uploaded stamp underneath, and the ink on
           top of it. Signing over a company stamp is how these forms are
           signed on paper, so it is how they are signed here (7.9.26). */
        .sigStage { position: relative; }
        .sigStage img.sigStampImg {
          position: absolute; inset: 6px; width: calc(100% - 12px); height: calc(100% - 12px);
          object-fit: contain; pointer-events: none;
        }
        .sigCanvas {
          display: block; width: 100%; height: 210px; border: 2px dashed var(--line);
          border-radius: 10px; background: transparent; touch-action: none; cursor: crosshair;
          position: relative;
        }
        .sigStage { background: #fff; border-radius: 10px; }
        .sigPadRow { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
        .sigStampRow { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
        .sigStampRow .sgGhost { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
        .sigPadRow .sgBtn:disabled { opacity: .45; cursor: default; }
        .sbLinkBtn {
          border: none; background: none; padding: 0; cursor: pointer; font-family: inherit;
          font-size: 12.5px; font-weight: 700; color: var(--accent); display: inline-flex;
          align-items: center; gap: 5px;
        }
        .sbLinkBtn:hover { text-decoration: underline; }
        .sbFormHead {
          display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
          gap: 12px; margin-bottom: 12px;
        }
        .sbFormHeadSide { display: flex; align-items: center; gap: 8px; }
        /* ---------- which language to print in ---------- */
        .printAskScrim {
          position: fixed; inset: 0; background: rgba(16,22,34,.55); z-index: 900;
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .printAskBox {
          background: #fff; border-radius: 14px; padding: 22px 26px; width: 100%; max-width: 380px;
          box-shadow: 0 20px 60px rgba(0,0,0,.3); text-align: center;
          font-family: 'Assistant', 'Inter', sans-serif; color: var(--ink);
        }
        .printAskBox h3 { margin: 0 0 6px; font-size: 17px; }
        .printAskBox p { margin: 2px 0; font-size: 13px; color: var(--steel); }
        .printAskEn { font-size: 12px !important; }
        .printAskBtns { display: flex; gap: 10px; margin: 18px 0 10px; }
        .printAskBtns button { flex: 1; }
        .printAskCancel { font-size: 12px; }
        .sbFormHeadSide.start { justify-content: flex-start; }
        .sbFormHeadSide.end { justify-content: flex-end; }
        @media (max-width: 640px) {
          .sbFormHead { grid-template-columns: 1fr; justify-items: center; }
          .sbFormHeadSide.start, .sbFormHeadSide.end { justify-content: center; }
        }
        .sbFormHead.noBack { margin-bottom: 6px; }
        .sbNoBox {
          border: 1px solid var(--accent); border-radius: 8px; padding: 5px 14px; text-align: center; line-height: 1.25;
        }
        .sbNoBox b { display: block; font-size: 9.5px; color: var(--accent); letter-spacing: .4px; }
        .sbNoBox span { font-size: 14px; font-weight: 800; }
        .sbNoBox i { display: block; font-style: normal; font-size: 10.5px; color: var(--mist); font-weight: 700; }
        .sbSecBar {
          background: var(--accent); color: #fff; text-align: center;
          font-size: 11.5px; font-weight: 800; letter-spacing: .5px;
          padding: 5px 0; margin: 16px 0 10px; border-radius: 5px;
        }
        .sbField { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .sbFieldLbl { font-size: 12px; font-weight: 700; color: var(--steel); }
        .sbDecisions { display: flex; flex-direction: column; gap: 3px; padding-top: 18px; }
        .sbDecRow { display: flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; }
        .sbLinkBtn.muted { color: var(--mist); font-weight: 600; }
        .sbSaveRow { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 22px 0 6px; }

        /* ---------- the screen's own buttons ----------
           Borrowed from the dashboard until 15.9.26 (.functionEditBtn,
           .ghostBtn, .drawerClose, .loginBack). Copied here under names of
           this file's own so the screen asks the page it lands on for
           nothing. The dashboard keeps its four, untouched, for its own use. */
        .sgBtn {
          padding: 10px 26px; border-radius: 999px; border: 1px solid var(--line);
          background: var(--surface); color: var(--ink); font-weight: 800; font-size: 13px;
          cursor: pointer; font-family: 'Assistant', sans-serif; transition: border-color .15s ease;
        }
        .sgBtn:hover { border-color: var(--accent); }
        .sgBtn[disabled], .sgBtn:disabled { opacity: .55; cursor: default; }
        .sgGhost {
          display: flex; align-items: center; gap: 6px; border: 1px solid var(--line);
          background: var(--surface); border-radius: 8px; padding: 8px 12px; font-size: 12.5px;
          font-weight: 700; color: var(--ink); cursor: pointer; white-space: nowrap;
          font-family: inherit;
        }
        .sgGhost:hover { border-color: var(--ink); }
        .sgGhost.small { padding: 7px 11px; font-size: 12px; }
        .sgClose {
          border: none; background: transparent; color: var(--steel); cursor: pointer;
          font-size: 18px; line-height: 1; padding: 4px 8px; font-family: inherit;
        }
        .sgClose:hover { color: var(--ink); }
        .sgBack {
          border: none; background: transparent; color: var(--steel); cursor: pointer;
          display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700;
          padding: 4px; font-family: inherit;
        }
        .sgBack:hover { color: var(--ink); }
        .sdSignErr {
          background: #fdf2f3; border: 1px solid #f0c4c9; color: #b02a37;
          border-radius: 8px; padding: 8px 12px; font-weight: 700; font-size: 12.5px;
        }
        .sdSignBusy {
          position: absolute; inset: 0; background: rgba(255,255,255,.82); z-index: 5;
          display: flex; align-items: center; justify-content: center;
          font-weight: 800; color: #103460; font-size: 14px;
        }
        .sdDrawWrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
        .sdDrawWrap img { display: block; max-width: 100%; }
        /* Signing over the stamp: the picture underneath, a drawing surface on
           top, one flattened image out. */
        .sdDrawWrap {
          position: relative; display: inline-block; border: 1px solid var(--line);
          border-radius: 10px; overflow: hidden; background: #fff; touch-action: none;
        }
        .sdStampPad img { max-width: 100%; max-height: 180px; }
        .sdStampPad.on { border-color: var(--accent); }

        /* the stamp picker */
        .sdStampPad {
          border: 2px dashed var(--line); border-radius: 10px; min-height: 130px;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          background: #fbfcfd; color: var(--steel); font-weight: 600; font-size: 12.5px;
          text-align: center; padding: 12px;
        }
        .sdSizeRow input[type="range"] { width: 130px; }
        .sdSizeRow { display: flex; align-items: center; gap: 8px; }
        .sdMoveBtn:hover { border-color: var(--accent); color: var(--accent); }
        .sdMarkBtn:hover { border-color: #c0392b; }
        .sdMoveBtn { inset-inline-start: -13px; color: var(--steel); cursor: move; }
        .sdMarkBtn { inset-inline-end: -13px; color: #c0392b; font-weight: 900; font-size: 15px; }
        .sdMarkBtn, .sdMoveBtn {
          position: absolute; top: -13px; width: 26px; height: 26px; z-index: 4;
          border-radius: 999px; border: 1px solid var(--line); background: #fff;
          cursor: pointer; padding: 0; font-family: inherit; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 6px rgba(16,32,58,.22);
        }
        .sdMark img { width: 100%; height: 100%; display: block; object-fit: contain; }
        /* Room for the handles to sit outside the mark without being clipped by
           the scrolling panel, and a stacking order that keeps them above the
           next mark along. */
        .sdSignScroll { padding: 26px 26px 40px; }
        .sdMark { position: absolute; box-sizing: border-box; }
        .sdNoteStamp { color: #4a5a72; border-top: 1px solid #c8d0dc; margin-top: 3px; padding-top: 2px; text-align: center; }
        .sdNoteText { color: #10275a; white-space: pre-wrap; word-break: break-word; text-align: center; }
        .sdNote textarea {
          width: 100%; border: none; outline: none; resize: none; background: transparent;
          font-family: inherit; color: #10275a; padding: 0; display: block; overflow: hidden;
          text-align: center;
        }

        /* an annotation, on screen. The burned PDF is drawn to match. */
        /* overflow must stay visible: the move and remove buttons hang outside
           the box on purpose, and clipping them left half a circle showing.
           The height is computed from the text, so nothing overflows anyway.
           (7.9.26) */
        .sdNote {
          position: absolute; box-sizing: border-box; background: rgba(255,255,255,.92);
          padding: 4px 6px; overflow: visible;
        }
        .sdSignPage.placing { cursor: crosshair; }
        .sdSignPage canvas { display: block; }
        .sdSignPage { position: relative; box-shadow: 0 6px 24px rgba(16,32,58,.16); background: #fff; direction: ltr; }
        .sdSignScroll { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .sdSignHint { font-size: 12px; color: var(--steel); font-weight: 600; }
        .sdSignBtn:disabled { opacity: .45; cursor: default; }
        .sdSignBtn.go:hover { background: #17693f; color: #fff; }
        .sdSignBtn.go { background: #1a7f4b; border-color: #1a7f4b; color: #fff; }
        .sdSignBtn.on { background: #10275a; border-color: #10275a; color: #fff; }
        .sdSignBtn:hover { border-color: var(--accent); color: var(--accent); }
        .sdSignBtn {
          display: inline-flex; align-items: center; gap: 6px;
          border: 1px solid var(--line); background: #fff; border-radius: 8px;
          padding: 6px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
          font-family: inherit; color: #16324f;
        }
        .sdSignName { font-size: 13px; font-weight: 800; color: #103460; margin-inline-end: auto; }
        .sdSignBar {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          padding: 9px 14px; background: #fff; border-bottom: 1px solid var(--line);
        }

        /* ---- the signing screen ---- */
        .sdSign { position: fixed; inset: 0; z-index: 950; background: #eceef1; display: flex; flex-direction: column; }
        .sdcAskBtn.primary:hover { background: #1f2733; color: #fff; }
        .sdcAskBtn.primary { background: #14181f; color: #fff; border-color: #14181f; }
        .sdcAskBtn:hover { border-color: var(--accent); color: var(--accent); }
        .sdcAskBtn {
          display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%;
          border: 1px solid var(--line); background: #fff; border-radius: 10px;
          padding: 11px 14px; font-size: 14px; font-weight: 700; cursor: pointer;
          font-family: inherit; color: #16324f; text-align: center;
        }
        .sdcAskRow { display: flex; flex-direction: column; gap: 8px; }
        /* A file name breaks anywhere; a sentence must not. The old rule broke
           "מכאן" across two lines and left a full stop stranded. (7.9.26) */
        .sdcAskName {
          margin: 0 0 16px; font-size: 12.5px; color: var(--steel); font-weight: 600;
          text-align: center; line-height: 1.55; overflow-wrap: anywhere;
        }
        .sdcAskTitle { margin: 0 0 6px; font-size: 16px; font-weight: 800; color: #103460; text-align: center; }
        .sdcAskBox {
          background: #fff; border-radius: 14px; padding: 22px 26px; width: 100%; max-width: 480px;
          box-shadow: 0 20px 60px rgba(0,0,0,.3); text-align: center;
        }

        /* ---- the little "download or sign" dialog ---- */
        .sdcAsk {
          position: fixed; inset: 0; z-index: 900; background: rgba(16,32,58,.42);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
`;

export {
  PrintLangAsk,
  PDFJS_VERSION,
  PDFJS_SOURCES,
  pdfJsLoadingPromise,
  loadScriptOnce,
  PRINT_PAGE_MM,
  PRINT_MARGIN_MM,
  PRINT_WIDE_MM,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUBMITTAL_BUCKET,
  SB_PRINT_PAGE_CAP,
  loadPdfJs,
  supabase,
  sbPagesOf,
  sbRenderSpecPages,
  sbSpecNoteList,
  SubmittalSpecs,
  SignaturePad,
  printedStampText,
  sanitizeFileNamePart,
  printSheetCss,
  printStaticPage,
  sbH,
  SUBMITTAL_CATEGORIES,
  SB_SUBCATS,
  sbSubcats,
  sbSubcatLabel,
  SB_L,
  SB_DOC_ROWS,
  SB_DECISIONS,
  SB_ACCENT,
  sbText,
  sbPad3,
  sbFmtDate,
  sbCatCode,
  sbNumber,
  sbStatusOf,
  sbStatusLabel,
  sbSignatureOf,
  sbReviewSignature,
  sbPrintName,
  sbEsc,
  sbBuildPrintHtml,
  sbPrint,
  sbIsClosed,
  SubmittalReview,
  signCss,
  // moved out of index.html 15.9.26 so the supervision page can reach them
  SDC_L,
  SD_STATUSES,
  SdSignScreen,
  boardFileName,
  fileToDataUrl,
  guessContentType,
  sbClipboardImage,
  sbFileUrl,
  sbToday,
  sdApprovalOf,
  sdClientStatus,
  sdFileLabel,
  sdStatus
};
