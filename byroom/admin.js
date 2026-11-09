// =============================================================================
//  byroom/admin.js — By Room for the system administrator. A. Weiss dashboard
//  byroom build 11 · 9.11.2026
//
//  The dashboard loads this file when the administrator opens the By Room cube.
//  It talks to Supabase through the shared client in ../sign.js and keeps all
//  of its data in the byroom_* tables. It never touches app_state.
//  The dashboard hands it one more thing: `marks` — what each mark (FL-2, FN-3…)
//  IS (name, description, photo), from the LLI rows ticked BY ROOM and the room
//  list's own corrections. Read only here; LLI stays the place it is maintained.
//
//  Three menus (her layout, 25.10.26):
//    העלאת תוכניות  — one button: floor, revision, date, notes and the files together;
//                      the versions underneath. A version holds its review, its approval
//                      log and its work files.
//    רשימת חדרים    — every approved room with its marks, and the floor map.
//    קישורים / QR    — the project's fixed message: WhatsApp, e-mail, printed QR.
//  Flow: upload -> processing (in the cloud) -> review per room -> tick V -> approve ticked.
//  Nothing reaches the approved data except byroom_approve_items(), for ticked rows.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";
import { supabase } from "../sign.js";
import { ByRoomViewer, FloorMap, KIND, KIND_OF_CAT, viewCss } from "./view.js";

const html = htm.bind(React.createElement);
export const BYROOM_BUILD = "byroom build 11 · 9.11.2026";
if (typeof console !== "undefined") console.info(BYROOM_BUILD);   // the build is in the console only, not on the screen

// ----------------------------------------------------------------------------- words
const W = {
  he: {
    title: "By Room", upload: "העלאת תוכניות", roomsList: "רשימת חדרים", qr: "קישורים / QR",
    versions: "גרסאות שהועלו", work: "קבצי עבודה", history: "יומן אישורים",
    newVersion: "העלאת תוכניות", floor: "קומה", name: "שם", remarks: "הערות", revision: "מהדורה", date: "תאריך", create: "יצירה", cancel: "ביטול",
    open: "פתיחה", back: "חזרה", files: "קבצים", drop: "גררו לכאן את כל קבצי הקומה (PDF, DXF, RVT) — או לחצו לבחירה",
    detected: "זיהוי מוצע", type: "סוג תוכנית", format: "פורמט", size: "גודל", status: "סטטוס", remove: "הסרה",
    confirm: "אישרתי את הזיהוי", send: "העלאה", uploading: "מעלה", processing: "בעיבוד", review: "לבדיקה",
    approveSel: "אישור שינויים מסומנים", selectCertain: "סימון כל הוודאיים", clear: "ניקוי סימון",
    showSame: "הצג גם ללא שינוי", all: "הכול", sources: "מקורות", note: "הערות", room: "חדר", boundary: "גבול", area: "שטח",
    noSets: "עדיין אין גרסאות לפרויקט הזה", wrongFloor: "הקובץ נראה של קומה אחרת", dup: "הקובץ כבר קיים בגרסה",
    keepOpen: "השאירו את הלשונית פתוחה עד סוף ההעלאה", canClose: "ההעלאה הסתיימה — אפשר לסגור את הדף, העיבוד ממשיך ברקע",
    retry: "ניסיון חוזר", reprocess: "עיבוד מחדש", crosscheck: "הצלבה מחדש", resumeHint: "בחרו שוב את אותו קובץ כדי להמשיך את ההעלאה",
    keep: "לשמור תמיד", purgeDue: "ניקוי קבצים שהגיע מועדם", purgeNow: "מחיקה עכשיו", due: "מועד ניקוי", purged: "נוקה",
    neverPdf: "PDF והנתונים המפוענחים נשמרים תמיד. רק DXF ו-RVT ניתנים לניקוי, ורק בלחיצה שלך.",
    key: "מפתח צפייה לפרויקט", makeKey: "יצירת מפתח", revoke: "ביטול המפתח", print: "הדפסה", copy: "העתקת קישור",
    noKey: "אין עדיין מפתח צפייה. בלי מפתח, קודי QR לא נפתחים.", approvedBy: "אושר על ידי", items: "שורות", leftPending: "נשארו ממתינות",
    warnings: "התראות", pdf: "PDF", choose: "בחירה", sheet: "גיליון", none: "—", unchanged: "ללא שינוי", saved: "נשמר",
  },
};
const STATUS = {
  certain: { he: "ודאי", c: "#1f7a3e", bg: "#e5f4ea" },
  estimated: { he: "משוער", c: "#9a5b00", bg: "#fff1d9" },
  conflict: { he: "סתירה", c: "#b02a37", bg: "#fbe4e6" },
  missing: { he: "חסר", c: "#5b5e66", bg: "#eceef2" },
  single: { he: "מקור אחד", c: "#1d5fa8", bg: "#e3eefb" },
};
const CHANGE = { new: "חדש", changed: "שונה", removed: "נמחק", same: "ללא שינוי" };
const FILE_ST = { pending: "ממתין", uploading: "מעלה", uploaded: "הועלה", processing: "מעבד", ready: "מוכן", failed: "נכשל", removed: "הוסר" };
const SET_ST = { draft: "טיוטה", uploading: "בהעלאה", processing: "בעיבוד", review: "לבדיקה", partly_approved: "אושרה חלקית", approved: "אושרה", failed: "נכשלה", archived: "בארכיון" };
const TYPES = { FL: "ריצוף", FN: "חיפויים", CL: "תקרה", SAN: "סניטריה", JOIN: "נגרות", LIGHT: "תאורה", MODEL: "מודל Revit", OTHER: "אחר" };
const FIELDS = ["name", "boundary", "area", "FL", "FN", "CL", "other"];
const BASE_FIELDS = ["room", "name", "boundary", "area", "FL", "FN", "CL"];
const FIELD_HE = { room: "חדר", name: "שם", boundary: "גבול", area: "שטח", FL: "ריצוף", FN: "חיפויים", CL: "תקרה", other: "איפיונים נוספים", lighting: "תאורה" };
// category names for marks beyond FL / FN / CL (joinery, lighting...) come from the dashboard's own category list
let CATS = [];
const catHe = (k) => FIELD_HE[k] ?? CATS.find((c) => c.key === k)?.he ?? k;

const css = `
.bra{font-family:'Assistant','Inter',sans-serif;color:var(--ink,#17181c);font-size:14px}
.bra h2{font-size:20px;margin:0 0 4px}.bra h3{font-size:16px;margin:16px 0 8px}
.bra-tabs{display:flex;gap:4px;border-bottom:1px solid #e6e6e9;margin:10px 0 14px;flex-wrap:wrap}
.bra-tab{padding:9px 14px;border:0;background:none;font:inherit;cursor:pointer;border-bottom:3px solid transparent;color:#5b5e66}
.bra-tab.on{color:var(--accent,#17181c);border-bottom-color:var(--accent,#17181c);font-weight:600}
.bra-btn{font:inherit;padding:7px 13px;border-radius:8px;border:1px solid #cfd3db;background:#fff;cursor:pointer;color:#17181c}
.bra-btn.primary{background:var(--accent,#17181c);border-color:var(--accent,#17181c);color:#fff}.bra-btn:disabled{opacity:.45;cursor:default}
.bra-btn.small{padding:4px 9px;font-size:13px}
.bra-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bra-card{background:#fff;border:1px solid #e6e6e9;border-radius:12px;padding:14px;margin-bottom:12px}
.bra table{border-collapse:collapse;width:100%;background:#fff}
.bra th,.bra td{border-bottom:1px solid #eceef2;padding:7px 8px;text-align:start;vertical-align:top}
.bra th{font-size:12px;color:#5b5e66;font-weight:600;background:#f6f6f7;position:sticky;top:0;z-index:1}
.bra-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.bra-drop{border:2px dashed #c3c8d2;border-radius:12px;padding:26px;text-align:center;color:#5b5e66;cursor:pointer;background:#fafafa}
.bra-drop.over{border-color:var(--accent,#17181c);background:var(--accent-soft,#eceef1)}
.bra-bar{height:6px;background:#eceef2;border-radius:3px;overflow:hidden;min-width:120px}
.bra-bar>i{display:block;height:100%;background:var(--accent,#17181c)}
.bra-warn{background:#fff6e0;border:1px solid #f1d38c;border-radius:10px;padding:10px 12px;margin:8px 0}
.bra-err{color:#b02a37}
.bra-rooms tr.rw{cursor:pointer}.bra-rooms tr.rw:hover td{background:#f6f7f9}
.bra-rooms tr.rw.on td{background:#dfe9f7;font-weight:600}.bra-rooms tr.rw.on td:first-child{box-shadow:inset -4px 0 0 #1d5fa8}
.bra-rooms tr.det>td{background:#f4f8fd;box-shadow:inset -4px 0 0 #1d5fa8;border-bottom:2px solid #1d5fa8;padding:10px 14px}
.bra-rooms .arr{font-size:11px;color:#1d5fa8}.bra-rooms tr.rw.on .arr{color:#14181f}
.bra-rooms thead th{position:sticky;top:0;background:#fff;z-index:2;box-shadow:0 1px 0 #e6e6e9}
.bra-rooms td.ntc{max-width:220px;font-size:12px;color:#5b5e66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bra-mk.nodet b{color:#8a6d1f;border-bottom:1px dashed #c9a24a}
.bra-pend{background:#fff1d6;color:#8a5a00;border-radius:8px;padding:1px 7px;font-size:11px;font-weight:600;white-space:nowrap}
.bra-pbox{background:#fffaf0;border:1px solid #f1d38c;border-radius:10px;padding:8px 10px;margin-bottom:10px}
.bra-pline{display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-bottom:1px dashed #f1e3bf}.bra-pline:last-of-type{border-bottom:0}
.bra-approvebar{background:#fffaf0;border:1px solid #f1d38c;border-radius:10px;padding:6px 10px;margin-bottom:8px}
.bra-rooms .bra-scroll{max-height:calc(var(--appvh, 100vh) - 230px);min-height:420px}
.bra-hc{font-size:11px;font-weight:400;color:#5b5e66;margin-top:2px;white-space:nowrap}
.bra-warn{position:relative}.bra-x{position:absolute;top:6px;left:8px;border:0;background:none;font-size:17px;line-height:1;color:#8a6d1f;cursor:pointer;padding:2px 4px}
.bra-x:hover{color:#000}
.bra input,.bra select{font:inherit;padding:6px 8px;border:1px solid #cfd3db;border-radius:8px;background:#fff}
.bra-cell{min-width:90px}.bra-cell .v{font-weight:600}.bra-cell .cur{color:#9a9da5;text-decoration:line-through;font-size:12px}
.bra-cell .alt{font-size:12px;color:#5b5e66}
.bra-scroll{max-height:68vh;overflow:auto;border:1px solid #e6e6e9;border-radius:10px}
.bra-src{font-size:12px;color:#5b5e66;margin:2px 0}
.bra-qrgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.bra-qr{border:1px solid #e6e6e9;border-radius:10px;padding:10px;text-align:center;background:#fff}
.bra-qr img{width:140px;height:140px}
.bra{width:100%}
table.bra-files{table-layout:fixed}
table.bra-files td{overflow-wrap:anywhere}
.bra-err.clamp{font-size:12px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:2px}
.bra-acts{display:flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end}
.bra-acts .bra-btn{white-space:nowrap}
.bra-trash{border:0;background:none;cursor:pointer;color:#9a9da5;padding:4px;border-radius:6px;display:inline-flex}
.bra-trash:hover:not(:disabled){color:#c0392b;background:#fbe4e6}
.bra-trash:disabled{opacity:.35;cursor:default}
.bra-panel{background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:14px;padding:16px 18px;min-height:calc(var(--appvh, 760px) - 250px);width:100%;box-sizing:border-box}
.bra-panel table{table-layout:auto}
.bra-foot{display:flex;justify-content:center;margin:16px 0 4px}
.bra-foot .ghostBtn{background:#14181f;color:#fff;border-color:#14181f;padding:10px 22px;font-size:13.5px}
.bra-stamp{text-align:center;font-size:10.5px;color:#9a9da5;margin-top:6px}
.bra-phone{height:min(660px,calc(100vh - 140px));height:min(660px,calc(100dvh - 140px));aspect-ratio:9/19;width:auto;max-width:94vw;border-radius:30px;border:8px solid #101114;overflow:hidden;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.bra-menu{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 16px}
.bra-menu button{font:inherit;font-size:15px;padding:12px 18px;border-radius:12px;border:1px solid #d8dbe2;background:#fff;color:#17181c;cursor:pointer;min-width:150px;font-weight:600}
.bra-menu button.on{background:var(--accent,#17181c);border-color:var(--accent,#17181c);color:#fff}
.bra-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.bra-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#5b5e66}
.bra-form label.wide{grid-column:1/-1}
.bra-form textarea{font:inherit;padding:6px 8px;border:1px solid #cfd3db;border-radius:8px;min-height:54px;resize:vertical}
.bra-sec{margin-top:22px;border-top:1px solid #e6e6e9;padding-top:4px}
.bra-mk{display:inline-flex;flex-direction:column;margin:0 0 4px 8px;vertical-align:top}
.bra-mk b{font-size:13px}.bra-mk span{font-size:11px;color:#5b5e66;max-width:180px}
.bra-mkrow{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f0f1f4}
.bra-mkrow.ver img,.bra-mkrow.ver .noimg{outline:2px solid #2e9e57;outline-offset:1px}
.bra-mkside{display:flex;flex-direction:column;align-items:center;gap:6px;width:34px;flex:none}
.bra-vc{width:26px;height:26px;border-radius:50%;border:2px solid #b9bcc4;background:#fff;color:transparent;font-weight:800;font-size:14px;line-height:1;cursor:pointer;padding:0}
.bra-vc:hover{border-color:#2e9e57;color:#9fd3b1}.bra-vc.on{background:#2e9e57;border-color:#2e9e57;color:#fff}
.bra-mknote{width:260px;flex:none}.bra-mknote textarea{width:100%;box-sizing:border-box;font-family:inherit;font-size:12.5px;border:1px solid #dfe1e6;border-radius:8px;padding:5px 7px;resize:vertical}
.bra-mknote .st{font-size:11px;color:#8a6d1f;min-height:14px}
.bra-link{border:0;background:none;color:#1d5fa8;cursor:pointer;font-size:12px;margin-inline-start:8px;padding:0}
.bra-edit{display:flex;flex-direction:column;gap:5px;margin-top:4px;max-width:640px}.bra-edit input,.bra-edit textarea{font-family:inherit;font-size:13px;border:1px solid #cfd2d8;border-radius:8px;padding:5px 7px}
.bra-mk.ok b::after{content:" ✓";color:#2e9e57}
.bra-mkrow img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e6e6e9}
.bra-mkrow .noimg{width:64px;height:64px;border-radius:8px;background:#f2f3f6}
.bra-tag{font-size:10px;font-weight:700;color:#1d5fa8;background:#e3eefb;border-radius:6px;padding:1px 5px;margin-inline-start:4px}
.bra-msgbox{white-space:pre-wrap;background:#f6f6f7;border:1px solid #e6e6e9;border-radius:10px;padding:12px;font-size:14px;line-height:1.55}
@media print{.bra-noprint{display:none!important}.bra-qrgrid{grid-template-columns:repeat(3,1fr)}.bra-qr{break-inside:avoid}}
`;

// ----------------------------------------------------------------------------- helpers
const fmtSize = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
const fmtDate = (s) => (s ? new Date(s).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "");
/** Per review column: how many rows are "ודאי" out of all rows (approved ones included — it measures the reading). */
const certainCounts = (rows) => {
  const out = {};
  for (const r of rows) {
    if (r.change_type === "removed") continue;
    const col = ["room", ...BASE_FIELDS].includes(r.field) ? r.field : "other";
    const c = (out[col] ||= { certain: 0, total: 0 });
    c.total++; if (r.status === "certain") c.certain++;
  }
  return out;
};
const pill = (st) => { const s = STATUS[st]; return s ? html`<span className="bra-pill" style=${{ color: s.c, background: s.bg }}>${s.he}</span>` : null; };
const fn = async (body) => {
  const { data, error } = await supabase.functions.invoke("byroom-admin", { body });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (e) {} throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data;
};
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/** What a file looks like from its name: format, plan type, floor, revision. Only a suggestion — shown for approval. */
export function detectFile(name) {
  const n = name.toUpperCase();
  const ext = n.split(".").pop();
  const format = ext === "PDF" ? "pdf" : ext === "DXF" ? "dxf" : ext === "RVT" ? "rvt" : null;
  let type = null, why = [];
  if (format === "rvt") { type = "MODEL"; why.push("קובץ Revit"); }
  else {
    const m = n.match(/(?:^|[-_\s])(FL|FN|CL)(?=[-_\s.])/);
    if (m) { type = m[1]; why.push(`"${m[1]}" בשם הקובץ`); }
    else if (/CEIL|תקר/.test(n)) { type = "CL"; why.push("תקרה בשם"); }
    else if (/FLOOR FINISH|ריצוף/.test(n)) { type = "FL"; why.push("ריצוף בשם"); }
    else if (/FINISH|חיפוי/.test(n)) { type = "FN"; why.push("גמר בשם"); }
    else if (/SANIT|PLUMB|סניטר|אינסטלצ/.test(n)) { type = "SAN"; why.push("סניטריה בשם"); }
    else if (/JOINER|CARPENT|MILLWORK|נגר/.test(n)) { type = "JOIN"; why.push("נגרות בשם"); }
    else if (/LIGHT|LIGHTING|תאור/.test(n)) { type = "LIGHT"; why.push("תאורה בשם"); }
  }
  let floor = null;
  const f1 = n.match(/(?:^|[-_\s])L(\d{1,3})(?=[-_\s.])/) || n.match(/(\d{1,3})(?:ST|ND|RD|TH)?[\s_-]*FLOOR/) || n.match(/קומה[\s_-]*(\d{1,3})/);
  if (f1) { floor = String(Number(f1[1])); why.push(`קומה ${floor} מהשם`); }
  const rev = format === "rvt" ? null : (n.match(/(?:^|[-_\s])(R\d{1,3}|REV[\s_-]*\w{1,4})(?=[-_\s.])/) || [])[1] || null;
  return { format, type, floor, revision: rev, why: why.join(" · ") };
}

async function sha256File(file, onProgress) {
  const { createSHA256 } = await import("https://esm.sh/hash-wasm@4.12.0");
  const h = await createSHA256();
  const step = 32 << 20;
  for (let o = 0; o < file.size; o += step) {
    h.update(new Uint8Array(await file.slice(o, o + step).arrayBuffer()));
    onProgress?.(Math.min(1, (o + step) / file.size));
  }
  return h.digest("hex");
}

// ----------------------------------------------------------------------------- resumable upload
// Cloud Storage resumable protocol: PUT with Content-Range; 308 = "kept up to Range"; chunks are multiples of
// 256 KiB except the last; the last carries the total size. A session lives a week; 404/410 = expired.
const CHUNK = 16 << 20;
const EXPIRED = "upload session expired";
const keptUpTo = (r) => { const g = r.headers.get("range"); return g ? Number(g.split("-")[1]) + 1 : 0; };

/** How much of the upload Google already holds. */
async function uploadStatus(session, total) {
  const r = await fetch(session, { method: "PUT", headers: { "Content-Range": `bytes */${total ?? "*"}` } });
  if (r.ok) return { done: true, offset: total };
  if (r.status === 308) return { done: false, offset: keptUpTo(r) };
  if (r.status === 404 || r.status === 410) throw new Error(EXPIRED);
  throw new Error(`upload status ${r.status}`);
}

/** Send body (which starts at `start`) until Google holds all of it. Returns the next offset.
 *  After a dropped connection it first asks Google what it kept, then sends only the rest. */
async function sendRange(session, body, start, total) {
  let stuck = 0;
  for (let attempt = 0; attempt < 8; ) {
    if (!body.byteLength && total == null) return start;
    const end = start + body.byteLength - 1;
    const range = body.byteLength ? `bytes ${start}-${end}/${total ?? "*"}` : `bytes */${total}`;
    let r = null;
    try { r = await fetch(session, { method: "PUT", headers: { "Content-Range": range }, body }); } catch (e) { r = null; }
    if (r && (r.status === 404 || r.status === 410)) throw new Error(EXPIRED);
    if (r && r.ok) return total ?? end + 1;
    if (r && r.status === 308) {
      const next = keptUpTo(r);
      if (next > start) { body = body.subarray(next - start); start = next; stuck = 0; if (!body.byteLength && total == null) return start; continue; }
      if (++stuck >= 2) throw new Error("the upload makes no progress — try again later");
      continue;
    }
    if (r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new Error(`upload refused (${r.status})`);
    // network error or a server hiccup: wait, then ask what was kept before sending again
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt++));
    const st = await uploadStatus(session, total).catch((e) => { if (e.message === EXPIRED) throw e; return null; });
    if (st?.done) return total;
    if (st && st.offset > start) { body = body.subarray(Math.min(body.byteLength, st.offset - start)); start = st.offset; }
  }
  throw new Error("the connection keeps failing — try again later");
}

/** Plain file (PDF, RVT): straight from disk, chunk by chunk; continues from where it stopped, even after a reload. */
async function uploadPlain(session, file, onProgress) {
  const st = await uploadStatus(session, file.size);
  let off = st.offset;
  if (st.done) { onProgress(1); return; }
  while (off < file.size) {
    const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
    off = await sendRange(session, buf, off, off + buf.byteLength >= file.size ? file.size : null);
    onProgress(off / file.size);
  }
}

/** DXF: compressed in the browser while it is sent (about 6 times smaller). A dropped connection is retried;
 *  if the page itself is closed, a DXF starts again (a compressed stream cannot be picked up half-way). */
async function uploadGzip(session, file, onProgress) {
  let readBytes = 0;
  const counted = file.stream().pipeThrough(new TransformStream({ transform(c, ctl) { readBytes += c.length; ctl.enqueue(c); } }));
  const reader = counted.pipeThrough(new CompressionStream("gzip")).getReader();
  let parts = [], size = 0, sent = 0, done = false;
  const take = (n) => {
    const out = new Uint8Array(n); let o = 0;
    while (o < n) { const p = parts[0]; const k = Math.min(p.length, n - o); out.set(p.subarray(0, k), o); o += k;
      if (k === p.length) parts.shift(); else parts[0] = p.subarray(k); }
    size -= n; return out;
  };
  while (true) {
    while (!done && size <= CHUNK) {
      const { value, done: d } = await reader.read();
      if (d) done = true; else { parts.push(value); size += value.length; }
    }
    const last = done && size <= CHUNK;
    const body = take(last ? size : CHUNK);
    sent = await sendRange(session, body, sent, last ? sent + body.byteLength : null);
    onProgress(Math.min(0.99, readBytes / file.size));
    if (last) break;
  }
  onProgress(1);
}

// ----------------------------------------------------------------------------- stuck processing (build 8)
// The cloud stops a job at its one-hour limit (or when it runs out of memory) without the job writing "failed",
// so the file stayed "מעבד" and the screen polled forever. A job older than the limit is now marked as stopped,
// a job that never started is marked too, and the rest of the version is cross-checked so it is not held back.
const STUCK_MIN = 65, NOSTART_MIN = 15;
const minsAgo = (t) => (t ? (Date.now() - new Date(t).getTime()) / 60000 : Infinity);
const BUSY_FILE = ["uploaded", "processing"];
async function sweepStuck(setId) {
  const set = must(await supabase.from("byroom_plan_sets").select("*").eq("id", setId).single());
  if (set.status !== "processing") return false;
  const files = must(await supabase.from("byroom_plan_files").select("*").eq("set_id", setId).neq("status", "removed"));
  const jobs = must(await supabase.from("byroom_parse_jobs").select("*").eq("set_id", setId).order("created_at", { ascending: false }).limit(60));
  let changed = false;
  for (const f of files.filter((x) => BUSY_FILE.includes(x.status))) {
    const j = jobs.find((x) => x.kind === "parse" && x.file_id === f.id);
    let why = null;
    if (j && ["running", "queued"].includes(j.status)) {
      if (minsAgo(j.started_at || j.created_at) > STUCK_MIN) why = "העיבוד נעצר: רץ יותר משעה בלי לסיים (מגבלת השרת). לרוב הקובץ כבד מדי — אפשר ללחוץ \"עיבוד מחדש\"";
    } else if ((!j || new Date(j.created_at) < new Date(set.updated_at)) && minsAgo(set.updated_at) > NOSTART_MIN) {
      why = "העיבוד לא התחיל אחרי " + NOSTART_MIN + " דקות. אפשר ללחוץ \"עיבוד מחדש\"";
    }
    if (!why) continue;
    if (j && ["running", "queued"].includes(j.status)) must(await supabase.from("byroom_parse_jobs").update({ status: "failed", finished_at: new Date().toISOString(), error: why }).eq("id", j.id));
    must(await supabase.from("byroom_plan_files").update({ status: "failed", error: why }).eq("id", f.id));
    f.status = "failed"; changed = true;
  }
  const cj = jobs.find((x) => x.kind === "crosscheck");
  if (cj && cj.status === "running" && minsAgo(cj.started_at) > STUCK_MIN) {
    must(await supabase.from("byroom_parse_jobs").update({ status: "failed", finished_at: new Date().toISOString(), error: "ההצלבה נעצרה אחרי שעה בלי לסיים" }).eq("id", cj.id));
    must(await supabase.from("byroom_plan_sets").update({ status: set.processed_at ? "review" : "failed", updated_at: new Date().toISOString() }).eq("id", setId));
    return true;
  }
  if (changed && !files.some((x) => ["pending", "uploading", ...BUSY_FILE].includes(x.status))) {
    // what the worker would have done when its last file finished: cross-check the files that were read
    if (files.some((x) => x.status === "ready")) { try { await fn({ action: "crosscheck", set_id: setId }); } catch (e) { console.warn("byroom crosscheck after stuck", e); } }
    else must(await supabase.from("byroom_plan_sets").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", setId));
  }
  return changed;
}

/** A notice at the bottom that can be closed. Closed notices stay closed in this browser (key = what it is about). */
const hiddenKey = "byroom-hidden-notices";
const readHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(hiddenKey) || "[]")); } catch (e) { return new Set(); } };
function useHidden() {
  const [h, setH] = useState(readHidden);
  const hide = (k) => setH((x) => { const n = new Set(x); n.add(k); try { localStorage.setItem(hiddenKey, JSON.stringify([...n].slice(-300))); } catch (e) {} return n; });
  return [h, hide];
}
const Notice = ({ err, onClose, children }) => html`<div className=${"bra-warn" + (err ? " bra-err" : "")} style=${{ paddingLeft: "30px" }}>
  <button className="bra-x" title="סגירה" aria-label="סגירה" onClick=${onClose}>×</button>${children}</div>`;

// ----------------------------------------------------------------------------- data
const useInterval = (fn, ms, on) => useEffect(() => { if (!on) return; const t = setInterval(fn, ms); return () => clearInterval(t); }, [on, ms]);

// ============================================================================= screens
const fmtDay = (s) => (s ? new Date(s).toLocaleDateString("he-IL") : "");

/** Fingerprint, register and upload the staged files of one version.
 *  Every file is registered BEFORE any upload starts: the set is not cross-checked while a registered
 *  file is still pending, so a small PDF finishing first cannot close the set early. */
async function runUpload({ set, staged, files, setProg, L }) {
  const { data: u } = await supabase.auth.getUser();
  // the processing job reads the project's defined marks to know which codes on a plan are marks
  try { await syncMarksNow?.(); } catch (e) { console.warn("[byroom] marks not synced", e); }
  const work = [];
  for (const r of staged) {
    if (r.bad || r.removed) continue;
    const key = r.file.name;
    const sha = await sha256File(r.file, (v) => setProg((p) => ({ ...p, [key]: { phase: "בודק קובץ", v } })));
    const same = files.find((f) => f.sha256 === sha);
    if (same && ["uploaded", "processing", "ready"].includes(same.status)) { setProg((p) => ({ ...p, [key]: { phase: L.dup, v: 1 } })); continue; }
    let id = same?.id ?? r.resume;               // a file whose earlier upload broke is continued, not duplicated
    if (id) {
      must(await supabase.from("byroom_plan_files").update({ plan_type: r.type, floor: r.floor, sha256: sha, error: null }).eq("id", id));
    } else {
      id = must(await supabase.from("byroom_plan_files").insert({
        set_id: set.id, project_id: set.project_id, floor: r.floor, plan_type: r.type, format: r.format,
        original_name: r.file.name, size_bytes: r.file.size, sha256: sha, gzip_in_transit: r.format === "dxf", status: "pending",
        detected: { suggested: detectFile(r.file.name), chosen: { type: r.type, floor: r.floor }, by: u?.user?.email },
      }).select().single()).id;
    }
    work.push({ r, id, key, old: same ?? files.find((f) => f.id === id) });
  }
  for (const { r, id, key, old } of work) {
    let session = old?.upload_session && r.format !== "dxf" ? old.upload_session : null;
    const onP = (v) => setProg((p) => ({ ...p, [key]: { phase: L.uploading, v } }));
    const send = async () => {
      if (!session) session = (await fn({ action: "start_upload", file_id: id, origin: location.origin })).session;
      if (r.format === "dxf") await uploadGzip(session, r.file, onP); else await uploadPlain(session, r.file, onP);
    };
    try { await send(); }
    catch (e) { if (e.message !== EXPIRED) throw e; session = null; await send(); }   // a week-old session: start over
    await fn({ action: "finish_upload", file_id: id });
    setProg((p) => ({ ...p, [key]: { phase: L.processing, v: 1 } }));
  }
}

/** The files chosen but not yet sent: what the system thinks each one is, for her to confirm. */
function Staged({ staged, setStaged, prog, busy, floor, L }) {
  const upd = (i, k, v) => setStaged((s) => s.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  if (!staged.some((r) => !r.removed)) return null;
  return html`<div style=${{ marginTop: "12px" }}>
    <h3>${L.detected}</h3>
    <table><thead><tr><th>קובץ</th><th>${L.format}</th><th>${L.type}</th><th>${L.floor}</th><th>${L.size}</th><th>למה</th><th></th></tr></thead>
      <tbody>${staged.map((r, i) => r.removed ? null : html`<tr key=${i}>
        <td>${r.file.name}${r.bad ? html`<div className="bra-err">${r.bad}</div>` : null}${r.resume ? html`<div style=${{ fontSize: "12px" }}>ימשיך העלאה שנקטעה</div>` : null}
          ${prog[r.file.name] ? html`<div>${prog[r.file.name].phase}<div className="bra-bar"><i style=${{ width: `${Math.round(prog[r.file.name].v * 100)}%` }} /></div></div>` : null}</td>
        <td>${r.format?.toUpperCase() ?? "?"}</td>
        <td><select disabled=${busy || r.format === "rvt"} value=${r.type} onChange=${(e) => upd(i, "type", e.target.value)}>
          ${Object.entries(TYPES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></td>
        <td><input style=${{ width: "56px" }} disabled=${busy} value=${r.floor ?? ""} onInput=${(e) => upd(i, "floor", e.target.value)} />
          ${floor && r.floor && r.floor !== floor ? html`<div className="bra-err" style=${{ fontSize: "12px" }}>${L.wrongFloor}</div>` : null}</td>
        <td>${fmtSize(r.file.size)}</td><td style=${{ fontSize: "12px" }}>${r.why}</td>
        <td><button className="bra-btn small" disabled=${busy} onClick=${() => upd(i, "removed", true)}>${L.remove}</button></td></tr>`)}</tbody></table>
  </div>`;
}

function DropZone({ onFiles, L }) {
  const [over, setOver] = useState(false);
  const inp = useRef(null);
  return html`<div className=${`bra-drop ${over ? "over" : ""}`} style=${{ marginTop: "4px" }}
    onClick=${() => inp.current?.click()} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
    ${L.drop}
    <input ref=${inp} type="file" multiple accept=".pdf,.dxf,.rvt" style=${{ display: "none" }} onChange=${(e) => { onFiles(e.target.files); e.target.value = ""; }} />
  </div>`;
}

const stageRows = (list, floor, files = []) => [...list].map((file) => {
  const d = detectFile(file.name);
  const resume = files.find((f) => f.original_name === file.name && f.size_bytes === file.size && ["uploading", "pending", "failed"].includes(f.status));
  return { file, ...d, floor: d.floor ?? floor ?? "", type: d.type ?? "OTHER", resume: resume?.id ?? null,
           bad: !d.format ? "פורמט לא נתמך (PDF, DXF, RVT בלבד)" : null };
});

/** "העלאת תוכניות": floor, revision, date and notes, and the files — one form, one button. */
function UploadForm({ projectId, onDone, onCancel, L }) {
  const [v, setV] = useState({ name: "", floor: "", revision: "", revision_date: new Date().toISOString().slice(0, 10), notes: "" });
  const [staged, setStaged] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [prog, setProg] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (msg !== L.canClose) return; const t = setTimeout(() => setMsg(null), 20000); return () => clearTimeout(t); }, [msg]);
  const add = (list) => {
    const rows = stageRows(list, v.floor.trim());
    // the floor and revision fill themselves from the first file names that carry them; she can change them
    const fl = v.floor.trim() || rows.find((r) => r.floor)?.floor || "";
    const rev = v.revision.trim() || rows.find((r) => r.revision)?.revision || "";
    if (fl !== v.floor || rev !== v.revision) setV((x) => ({ ...x, floor: fl, revision: rev }));
    setStaged((s) => [...s, ...rows.map((r) => ({ ...r, floor: r.floor || fl }))]);
    setConfirmed(false);
  };
  const ready = staged.some((r) => !r.bad && !r.removed);
  const go = async () => {
    setBusy(true); setMsg(L.keepOpen);
    let set = null;
    try {
      const { data: u } = await supabase.auth.getUser();
      set = must(await supabase.from("byroom_plan_sets").insert({
        project_id: projectId, floor: v.floor.trim(), name: v.name.trim(), remarks: v.notes.trim() || null, revision: v.revision.trim() || null,
        revision_date: v.revision_date || null, created_email: u?.user?.email ?? null,
      }).select().single());
      await runUpload({ set, staged, files: [], setProg, L });
      setMsg(L.canClose); setBusy(false);
      onDone(set.id);
    } catch (e) { setMsg(null); setBusy(false); alert(e.message); if (set) onDone(set.id); }
  };
  const field = (k, label, props = {}) => html`<label>${label}<input value=${v[k]} disabled=${busy} onInput=${(e) => setV({ ...v, [k]: e.target.value })} ...${props} /></label>`;
  return html`<div className="bra-card">
    <h3 style=${{ marginTop: 0 }}>${L.newVersion}</h3>
    <div className="bra-form">
      ${field("name", L.name + " *", { placeholder: "למשל: תוכניות גמר — אוגוסט 2026" })}
      ${field("floor", L.floor + " *", { style: { width: "90px" } })}
      ${field("revision", L.revision)}
      ${field("revision_date", L.date, { type: "date" })}
      <label className="wide">${L.remarks}<textarea value=${v.notes} disabled=${busy} placeholder="למשל: מהדורה לאחר הערות אדריכל" onInput=${(e) => setV({ ...v, notes: e.target.value })} /></label>
    </div>
    ${!busy && html`<${DropZone} onFiles=${add} L=${L} />`}
    <${Staged} staged=${staged} setStaged=${setStaged} prog=${prog} busy=${busy} floor=${v.floor.trim()} L=${L} />
    <div className="bra-row" style=${{ marginTop: "12px" }}>
      ${ready && html`<label><input type="checkbox" checked=${confirmed} disabled=${busy} onChange=${(e) => setConfirmed(e.target.checked)} /> ${L.confirm}</label>`}
      <button className="bra-btn primary" disabled=${!ready || !confirmed || !v.floor.trim() || !v.name.trim() || busy} onClick=${go}>${L.send}</button>
      <button className="bra-btn" disabled=${busy} onClick=${onCancel}>${L.cancel}</button>
      ${ready && (!v.floor.trim() || !v.name.trim()) ? html`<span className="bra-err">חסרים ${[!v.name.trim() && "שם", !v.floor.trim() && "קומה"].filter(Boolean).join(" ו")}</span>` : null}
    </div>
    ${msg && html`<${Notice} onClose=${() => setMsg(null)}>${msg}</${Notice}>`}
  </div>`;
}

function UploadTab({ projectId, projectName, L, openId, onOpened }) {
  const [sets, setSets] = useState(null);
  const [open, setOpen] = useState(openId ?? null);
  const sweptAt = useRef({});
  useEffect(() => { if (openId) { setOpen(openId); onOpened?.(); } }, [openId]);
  const load = async () => {
    const s = must(await supabase.from("byroom_plan_sets").select("*").eq("project_id", projectId).order("created_at", { ascending: false }));
    const ids = s.map((x) => x.id);
    const f = ids.length ? must(await supabase.from("byroom_plan_files").select("set_id, format").in("set_id", ids).neq("status", "removed")) : [];
    // a version "בעיבוד" for a long time: check whether its job was stopped (at most once in 2 minutes per version)
    let swept = false;
    for (const x of s.filter((y) => y.status === "processing" && minsAgo(y.updated_at) > NOSTART_MIN)) {
      if (Date.now() - (sweptAt.current[x.id] || 0) < 120000) continue;
      sweptAt.current[x.id] = Date.now();
      try { swept = (await sweepStuck(x.id)) || swept; } catch (e) { console.warn("byroom sweep", e); }
    }
    if (swept) return load();
    setSets(s.map((x) => ({ ...x, nfiles: f.filter((y) => y.set_id === x.id).length, formats: [...new Set(f.filter((y) => y.set_id === x.id).map((y) => y.format.toUpperCase()))].join(" · ") })));
  };
  useEffect(() => { load(); }, [projectId]);
  useInterval(load, 8000, !open && sets?.some((s) => s.status === "processing" || (s.status === "uploading" && minsAgo(s.updated_at) < 30)));
  if (open) return html`<${SetScreen} setId=${open} projectName=${projectName} L=${L} onBack=${() => { setOpen(null); load(); }} />`;
  if (!sets) return html`<p>…</p>`;
  return html`<div>
    <h3 style=${{ marginTop: 0 }}>${L.versions}</h3>
    ${!sets.length ? html`<p>${L.noSets}</p>` : html`<table>
      <thead><tr><th>${L.name}</th><th>${L.floor}</th><th>${L.revision}</th><th>${L.date}</th><th>${L.remarks}</th><th>${L.files}</th><th>${L.status}</th><th>הועלה</th><th></th><th></th></tr></thead>
      <tbody>${sets.map((s) => html`<tr key=${s.id}>
        <td><b>${s.name}</b></td><td>${s.floor}</td><td>${s.revision ?? ""}</td><td>${fmtDay(s.revision_date)}</td>
        <td style=${{ maxWidth: "260px", whiteSpace: "pre-wrap", fontSize: "13px" }}>${s.remarks ?? ""}</td>
        <td>${s.nfiles}${s.formats ? html`<div style=${{ fontSize: "11px", color: "#5b5e66" }}>${s.formats}</div>` : null}</td>
        <td>${SET_ST[s.status] ?? s.status}</td>
        <td style=${{ fontSize: "12px" }}>${fmtDate(s.created_at)}${s.created_email ? html`<div>${s.created_email}</div>` : null}</td>
        <td><button className="bra-btn small" onClick=${() => setOpen(s.id)}>${s.status === "review" || s.status === "partly_approved" ? "בדיקה ואישור" : L.open}</button></td>
        <td>${(() => { const kept = ["approved", "partly_approved"].includes(s.status); return html`<button className="bra-trash" disabled=${kept}
          title=${kept ? "גרסה שאושרו ממנה שינויים נשמרת לתיעוד ואי אפשר למחוק אותה" : "מחיקת הגרסה"} aria-label="מחיקת הגרסה"
          onClick=${async () => { if (!confirm(`למחוק את הגרסה "${s.name}" (קומה ${s.floor}) עם כל ${s.nfiles} הקבצים שלה?\nהקבצים יימחקו גם מהאחסון. אי אפשר לבטל.`)) return;
            try { await fn({ action: "delete_set", set_id: s.id }); load(); } catch (e) { alert(e.message); } }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg></button>`; })()}</td></tr>`)}</tbody></table>`}
  </div>`;
}

// ----------------------------------------------------------------------------- one version: files, review, log, work files
function SetScreen({ setId, projectName, onBack, L }) {
  const [set, setSet] = useState(null);
  const [files, setFiles] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [staged, setStaged] = useState([]);           // added on this screen, not yet uploaded
  const [confirmed, setConfirmed] = useState(false);
  const [prog, setProg] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (msg !== L.canClose) return; const t = setTimeout(() => setMsg(null), 20000); return () => clearTimeout(t); }, [msg]);
  const [adding, setAdding] = useState(false);

  const sweptAt = useRef(0);
  const [hidden, hide] = useHidden();
  const load = async () => {
    if (Date.now() - sweptAt.current > 60000) { sweptAt.current = Date.now(); try { await sweepStuck(setId); } catch (e) { console.warn("byroom sweep", e); } }
    setSet(must(await supabase.from("byroom_plan_sets").select("*").eq("id", setId).single()));
    setFiles(must(await supabase.from("byroom_plan_files").select("*").eq("set_id", setId).neq("status", "removed").order("created_at")));
    setJobs(must(await supabase.from("byroom_parse_jobs").select("*").eq("set_id", setId).order("created_at", { ascending: false }).limit(30)));
  };
  useEffect(() => { load(); }, [setId]);
  // polling stops by itself: a stopped job is marked failed by sweepStuck, and an upload left half-way is not polled
  const live = set && set.status === "processing" || files.some((f) => BUSY_FILE.includes(f.status));
  const runningFor = (f) => { const j = jobs.find((x) => x.kind === "parse" && x.file_id === f.id && x.status === "running"); return j ? Math.max(0, Math.round(minsAgo(j.started_at))) : null; };
  // only the newest job of each file (and the newest cross-check) can be a current failure; older ones are history
  const lastJobs = [...new Map(jobs.map((j) => [j.kind + "|" + (j.file_id ?? ""), j]).reverse()).values()];
  const failures = lastJobs.filter((j) => j.status === "failed" && !hidden.has("job:" + j.id) && (!j.file_id || files.some((f) => f.id === j.file_id && f.status === "failed")));
  const warnKey = "warn:" + setId + ":" + (set?.processed_at ?? "");
  useInterval(load, 5000, live && !busy);

  const uploadMore = async () => {
    setBusy(true); setMsg(L.keepOpen);
    try { await runUpload({ set, staged, files, setProg, L }); setStaged([]); setAdding(false); setMsg(L.canClose); }
    catch (e) { setMsg(null); alert(e.message); }
    setBusy(false); load();
  };

  if (!set) return html`<p>…</p>`;
  const note = (() => { try { return JSON.parse(set.note || "{}"); } catch (e) { return {}; } })();
  const reviewable = ["review", "partly_approved", "approved"].includes(set.status);
  const ready = staged.some((r) => !r.bad && !r.removed);
  return html`<div>
    <div className="bra-row" style=${{ justifyContent: "space-between" }}>
      <div><h2>${set.name || `${L.floor} ${set.floor}`}</h2>
        <div style=${{ color: "#5b5e66" }}>${projectName} · ${L.floor} ${set.floor}${set.revision ? ` · ${L.revision} ${set.revision}` : ""}${set.revision_date ? ` · ${fmtDay(set.revision_date)}` : ""} · ${SET_ST[set.status]}</div>
        ${set.remarks ? html`<div style=${{ whiteSpace: "pre-wrap", marginTop: "4px" }}>${set.remarks}</div>` : null}</div>
      <button className="bra-btn" onClick=${onBack}>${L.back}</button>
    </div>

    <h3>${L.files}</h3>
    ${files.length ? html`<table className="bra-files"><colgroup><col style=${{ width: "34%" }} /><col style=${{ width: "9%" }} /><col style=${{ width: "6%" }} /><col style=${{ width: "8%" }} /><col style=${{ width: "9%" }} /><col style=${{ width: "12%" }} /><col style=${{ width: "22%" }} /></colgroup>
      <thead><tr><th>קובץ</th><th>${L.type}</th><th>${L.floor}</th><th>${L.size}</th><th>${L.status}</th><th>זוהה בתוכן</th><th></th></tr></thead>
      <tbody>${files.map((f) => html`<tr key=${f.id}>
        <td className="nm"><bdi dir="auto">${f.original_name}</bdi>${f.error ? html`<div className="bra-err clamp" dir="auto" title=${f.error}>${f.error}</div>` : null}</td>
        <td>${TYPES[f.plan_type]}</td><td>${f.floor}</td><td>${fmtSize(f.size_bytes)}</td>
        <td>${FILE_ST[f.status]}${f.status === "processing" && runningFor(f) != null ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>${runningFor(f)} דק׳</div>` : null}${f.status === "uploading" ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>${L.resumeHint}</div>` : null}</td>
        <td style=${{ fontSize: "12px" }}>${f.detected?.content_hint ? `${TYPES[f.detected.content_hint] ?? f.detected.content_hint}${f.detected.content_hint !== f.plan_type && f.detected.content_hint !== "MODEL" ? " ⚠" : ""}` : ""}
          ${f.detected?.dates?.length ? html`<div>תאריכים: ${f.detected.dates.slice(0, 3).join(", ")}</div>` : null}</td>
        <td><div className="bra-acts">
          ${f.format === "pdf" && f.archive_path ? html`<button className="bra-btn small" onClick=${async () => window.open((await fn({ action: "pdf_url", file_id: f.id })).url)}>${L.pdf}</button>` : null}
          ${["failed", "ready"].includes(f.status) ? html`<button className="bra-btn small" onClick=${async () => { await fn({ action: "reprocess", file_id: f.id }); load(); }}>${L.reprocess}</button>` : null}
          <button className="bra-btn small" onClick=${async () => { if (confirm(`להסיר את ${f.original_name} מהגרסה?`)) { await fn({ action: "remove_file", file_id: f.id }); load(); } }}>${L.remove}</button>
        </div></td></tr>`)}</tbody></table>` : html`<p>עדיין אין קבצים בגרסה הזו.</p>`}

    ${adding || files.some((f) => ["pending", "uploading", "failed"].includes(f.status)) ? html`
      <${DropZone} onFiles=${(l) => { setStaged((s) => [...s, ...stageRows(l, set.floor, files)]); setConfirmed(false); }} L=${L} />
      <${Staged} staged=${staged} setStaged=${setStaged} prog=${prog} busy=${busy} floor=${set.floor} L=${L} />
      ${ready && html`<div className="bra-row" style=${{ marginTop: "10px" }}>
        <label><input type="checkbox" checked=${confirmed} disabled=${busy} onChange=${(e) => setConfirmed(e.target.checked)} /> ${L.confirm}</label>
        <button className="bra-btn primary" disabled=${!confirmed || busy} onClick=${uploadMore}>${L.send}</button></div>`}`
      : html`<button className="bra-btn small" style=${{ marginTop: "8px" }} onClick=${() => setAdding(true)}>＋ הוספת קובץ לגרסה</button>`}
    ${msg && html`<${Notice} onClose=${() => setMsg(null)}>${msg}</${Notice}>`}

    ${note.warnings?.length && !hidden.has(warnKey) ? html`<${Notice} onClose=${() => hide(warnKey)}><b>${L.warnings}</b><ul>${note.warnings.map((w, i) => html`<li key=${i}>${w}</li>`)}</ul></${Notice}>` : null}
    ${failures.map((j) => html`<${Notice} err key=${j.id} onClose=${() => hide("job:" + j.id)}>${j.kind === "crosscheck" ? "הצלבה" : "עיבוד"} נכשל${j.file_id ? ` (${files.find((f) => f.id === j.file_id)?.original_name ?? ""})` : ""}: ${j.error}</${Notice}>`)}
    ${files.some((f) => ["ready", "failed"].includes(f.status)) ? html`<div className="bra-row" style=${{ margin: "8px 0" }}>
      ${files.some((f) => f.status === "ready") ? html`<button className="bra-btn small" onClick=${async () => { await fn({ action: "crosscheck", set_id: setId }); load(); }}>${L.crosscheck}</button>` : null}
      <button className="bra-btn small" title="קורא שוב את כל קבצי הגרסה (אחרי עדכון של שרת העיבוד), ובסוף מצליב"
        onClick=${async () => { const all = files.filter((f) => ["ready", "failed"].includes(f.status)); if (!confirm(`לעבד מחדש את כל ${all.length} הקבצים בגרסה?`)) return;
          try { for (const f of all) await fn({ action: "reprocess", file_id: f.id }); } catch (e) { alert(e.message); } load(); }}>עיבוד מחדש לכל הקבצים</button></div>` : null}

    ${reviewable ? html`<${Review} set=${set} files=${files} L=${L} onApproved=${load} />` : null}
    <div className="bra-sec"><h3>${L.history}</h3><${History} setId=${setId} L=${L} /></div>
    <div className="bra-sec"><h3>${L.work}</h3><${WorkFiles} setId=${setId} L=${L} /></div>
  </div>`;
}

// ----------------------------------------------------------------------------- review + V
function Review({ set, files, onApproved, L }) {
  const [items, setItems] = useState(null);
  const [tick, setTick] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [showSame, setShowSame] = useState(false);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const rows = must(await supabase.from("byroom_room_review").select("*").eq("set_id", set.id).order("id"));
    // older approved rows of a re-run stay as history; show the newest row per room+field
    const last = new Map();
    for (const r of rows) last.set(r.room_no + "|" + r.field, r);
    setItems([...last.values()]);
  };
  useEffect(() => { load(); }, [set.id, set.processed_at]);
  // the previous version of the same floor, to see whether the reading got better (build 8)
  const [prev, setPrev] = useState(null);
  useEffect(() => { (async () => {
    try {
      const p = must(await supabase.from("byroom_plan_sets").select("id, name, revision, created_at").eq("project_id", set.project_id).eq("floor", set.floor)
        .lt("created_at", set.created_at).in("status", ["review", "partly_approved", "approved"]).order("created_at", { ascending: false }).limit(1))[0];
      if (!p) return setPrev(null);
      const rows = must(await supabase.from("byroom_room_review").select("room_no, field, status, change_type").eq("set_id", p.id).order("id"));
      const last = new Map(); for (const r of rows) last.set(r.room_no + "|" + r.field, r);
      setPrev({ ...p, counts: certainCounts([...last.values()]) });
    } catch (e) { console.warn("byroom previous version", e); setPrev(null); }
  })(); }, [set.id]);
  if (!items) return html`<p>…</p>`;

  const byRoom = new Map();
  for (const it of items) { if (!byRoom.has(it.room_no)) byRoom.set(it.room_no, {}); byRoom.get(it.room_no)[it.field] = it; }
  const num = (s) => { const m = /^(\d+)(.*)$/.exec(s); return m ? [Number(m[1]), m[2]] : [1e9, s]; };
  const rooms = [...byRoom.keys()].sort((a, b) => { const x = num(a), y = num(b); return x[0] - y[0] || String(x[1]).localeCompare(y[1]); });
  const pending = items.filter((i) => i.decision === "pending");
  const visible = rooms.filter((r) => {
    const f = Object.values(byRoom.get(r));
    if (!showSame && f.every((i) => i.decision !== "pending")) return false;
    return filter === "all" || f.some((i) => i.status === filter && (showSame || i.decision === "pending"));
  });
  // "סימון הכל": every pending row of the rooms on screen; with a status filter, only rows of that status (build 8)
  const allShown = visible.flatMap((r) => Object.values(byRoom.get(r))).filter((i) => i.decision === "pending" && (filter === "all" || i.status === filter));
  const toggle = (id) => setTick((t) => { const n = new Set(t); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approve = async () => {
    setBusy(true);
    try {
      const r = must(await supabase.rpc("byroom_approve_items", { p_set: set.id, p_ids: [...tick] }));
      alert(r.approved ? `אושרו ${r.approved} שורות · נשארו ${r.pending} ממתינות` : "השורות שסומנו כבר אינן עדכניות (הייתה הצלבה חדשה). הטבלה נטענה מחדש — סמנו שוב.");
      setTick(new Set()); await load(); onApproved?.();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const chooseAlt = async (it, src) => {
    const codes = it.proposed.alternatives?.[src] ?? [];
    must(await supabase.from("byroom_room_review").update({ proposed: { ...it.proposed, codes, chosen: src } }).eq("id", it.id));
    load();
  };
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, pending.filter((i) => i.status === k).length]));
  const cc = certainCounts(items);
  const head = (col, label) => {
    const c = cc[col] || { certain: 0, total: 0 };
    const p = prev?.counts?.[col];
    const d = p ? c.certain - p.certain : null;
    return html`<th key=${col}>${label}${c.total ? html`<div className="bra-hc" title=${`ודאי מתוך כל השורות בעמודה${p ? ` · בגרסה הקודמת (${prev.name}${prev.revision ? " " + prev.revision : ""}): ${p.certain}/${p.total}` : ""}`}>
      ודאי ${c.certain}/${c.total}${d ? html` <span style=${{ color: d > 0 ? "#1f7a3a" : "#b02a37" }}>${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>` : p ? html` <span style=${{ color: "#5b5e66" }}>=</span>` : null}</div>` : null}</th>`;
  };

  const cell = (it) => {
    if (!it) return html`<td className="bra-cell">${L.none}</td>`;
    if (Array.isArray(it)) return it.length ? html`<td className="bra-cell">${it.map((x) => html`<div key=${x.id} style=${{ marginBottom: "6px" }}>
      <div style=${{ fontSize: "11px", color: "#5b5e66", fontWeight: 700 }}>${catHe(x.field)}</div>${one(x)}</div>`)}</td>` : html`<td className="bra-cell">${L.none}</td>`;
    return html`<td className="bra-cell" style=${{ background: STATUS[it.status]?.bg }}>${one(it)}</td>`;
  };
  const one = (it) => {
    const p = it.proposed || {}, c = it.current || {};
    const isMark = !["room", "name", "area", "boundary"].includes(it.field);
    const val = isMark ? (p.codes || []).join(", ") || "—"
      : it.field === "boundary" ? (p.poly ? `נסגר${p.geom_area ? ` · ${p.geom_area} מ"ר` : ""}` : "לא נסגר")
      : it.field === "room" ? (it.change_type === "removed" ? "נמחק" : "קיים") : (p.value ?? "—");
    const cur = it.change_type === "changed" ? (isMark ? (c.codes || []).join(", ") : it.field === "boundary" ? "גבול קודם" : c.value) : null;
    return html`<div>
      <div className="bra-row" style=${{ gap: "6px", flexWrap: "nowrap" }}>
        ${it.decision === "pending" ? html`<input type="checkbox" title="V" checked=${tick.has(it.id)} onChange=${() => toggle(it.id)} />` : html`<span title=${it.decision === "approved" ? "אושר" : L.unchanged}>${it.decision === "approved" ? "✓" : "="}</span>`}
        <span className="v">${String(val)}</span>${it.rvt_verified ? html`<span title="אומת גם במודל Revit" style=${{ fontSize: "11px" }}> ·RVT</span>` : null}
      </div>
      ${cur != null ? html`<div className="cur">${String(cur)}</div>` : null}
      <div className="alt">${pill(it.status)} ${it.change_type !== "same" ? CHANGE[it.change_type] : ""}</div>
      ${it.status === "conflict" && it.proposed?.alternatives && it.decision === "pending" ? html`<div className="alt">
        ${Object.entries(it.proposed.alternatives).filter(([, v]) => v?.length).map(([k, v]) => html`<button key=${k} className="bra-btn small" style=${{ marginTop: "3px", fontWeight: it.proposed.chosen === k ? 700 : 400 }} onClick=${() => chooseAlt(it, k)}>${k}: ${v.join(", ")}</button>`)}</div>` : null}
    </div>`;
  };

  return html`<div>
    <h3>בדיקה ואישור לפי חדר</h3>
    <div className="bra-row" style=${{ marginBottom: "8px" }}>
      <select value=${filter} onChange=${(e) => setFilter(e.target.value)}>
        <option value="all">${L.all} (${pending.length} ממתינות)</option>
        ${Object.entries(STATUS).map(([k, s]) => html`<option key=${k} value=${k}>${s.he} (${counts[k]})</option>`)}
      </select>
      <label><input type="checkbox" checked=${showSame} onChange=${(e) => setShowSame(e.target.checked)} /> ${L.showSame}</label>
      <button className="bra-btn small" onClick=${() => setTick(new Set(pending.filter((i) => i.status === "certain").map((i) => i.id)))}>${L.selectCertain}</button>
      <button className="bra-btn small" title="מסמן V על כל השורות הממתינות שמוצגות כרגע (לפי הסינון שנבחר)" onClick=${() => setTick(new Set(allShown.map((i) => i.id)))}>סימון הכל (${allShown.length})</button>
      <button className="bra-btn small" onClick=${() => setTick(new Set())}>${L.clear}</button>
      <span style=${{ flex: 1 }} />
      <b>${tick.size} מסומנות</b>
      <button className="bra-btn primary" disabled=${!tick.size || busy} onClick=${approve}>${L.approveSel}</button>
    </div>
    <div className="bra-scroll"><table>
      <thead><tr>${head("room", L.room)}${FIELDS.map((f) => head(f, FIELD_HE[f]))}<th>${L.note}</th></tr></thead>
      <tbody>${visible.map((r) => {
        const f = byRoom.get(r);
        const notes = Object.values(f).map((i) => i.note).filter(Boolean);
        return html`<${React.Fragment} key=${r}>
          <tr>
            <td style=${{ cursor: "pointer" }} onClick=${() => setOpen(open === r ? null : r)}>
              ${f.room && f.room.decision === "pending" ? html`<input type="checkbox" title="V" checked=${tick.has(f.room.id)} onClick=${(e) => e.stopPropagation()} onChange=${() => toggle(f.room.id)} />` : null}
              <b> ${r}</b>${f.room?.rvt_verified ? html`<span style=${{ fontSize: "11px" }}> ·RVT</span>` : null}
              <div>${f.room ? pill(f.room.status) : null} ${f.room && f.room.change_type !== "same" ? CHANGE[f.room.change_type] : ""}</div>
              <div style=${{ fontSize: "12px", color: "#1d5fa8" }}>${open === r ? "▲" : "▼"} ${L.sources}</div>
            </td>
            ${FIELDS.map((k) => html`<${React.Fragment} key=${k}>${cell(k === "other" ? Object.values(f).filter((i) => !BASE_FIELDS.includes(i.field)) : f[k])}</${React.Fragment}>`)}
            <td style=${{ fontSize: "12px", maxWidth: "260px" }}>${notes.join(" · ")}</td>
          </tr>
          ${open === r ? html`<tr><td colSpan=${FIELDS.length + 2} style=${{ background: "#fafafa" }}>
            ${Object.values(f).map((it) => html`<div key=${it.id} style=${{ marginBottom: "6px" }}><b>${catHe(it.field)}</b>
              ${(it.sources || []).map((s, i) => html`<div className="bra-src" key=${i}>${s.src} · ${s.file}${s.value != null ? ` · ${s.value}` : ""} — ${s.how}${s.confidence ? ` (${STATUS[s.confidence]?.he ?? s.confidence})` : ""}</div>`)}</div>`)}
          </td></tr>` : null}
        </${React.Fragment}>`;
      })}</tbody></table></div>
  </div>`;
}

// ----------------------------------------------------------------------------- marks (from the dashboard: LLI + room list)
// `marks` arrives keyed "category|MARK" (flooring|FL-2), the same keys the LLI board and the old room list use.
// A mark's KIND is what By Room stores: FL / FN / CL for flooring / wall finishes / ceiling, the category key otherwise.
export const kindOfCat = (cat) => { const k = KIND_OF_CAT[cat] ?? cat ?? "other"; return /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k) ? k : "other"; };

/** The LLI marks with the By Room edits laid over them: name / description replaced, the LLI wording kept beside. */
function mergeEdits(marks, edits) {
  if (!edits?.size) return marks;
  const out = {};
  for (const [key, v] of Object.entries(marks || {})) {
    const code = String(v?.mark || key.split("|")[1] || "").trim().toUpperCase();
    const e = edits.get(code);
    out[key] = e ? { ...v, name: e.name || v.name, desc: e.description ?? v.desc, edited: { at: e.updated_at, by: e.updated_email }, lliName: v.name, lliDesc: v.desc } : v;
  }
  return out;
}

/** Every defined mark, one per code: [{code, kind, name, desc, image, supplier, status, fromLli}] */
export function markList(marks) {
  const by = new Map();
  for (const [key, v] of Object.entries(marks || {})) {
    if (!v || v.hidden) continue;
    const [cat, mk] = key.split("|");
    const code = String(v.mark || mk || "").trim().toUpperCase();
    if (!code || !/[0-9]/.test(code)) continue;
    const prev = by.get(code);
    const m = { ...v, code, kind: kindOfCat(v.cat || cat) };
    // two entries for one code: the one with more to say wins
    if (!prev || (!prev.desc && m.desc) || (!prev.image && m.image)) by.set(code, prev ? { ...prev, ...Object.fromEntries(Object.entries(m).filter(([, x]) => x)) } : m);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
}
export function markIndex(marks) {
  const by = new Map(markList(marks).map((m) => [m.code, m]));
  return (kind, code) => by.get(String(code || "").trim().toUpperCase()) ?? null;
}

/** Copy the defined marks into byroom_marks: the QR page shows them, and the processing job reads them
 *  to know which codes on a plan are marks. Small chunks: a photo can weigh tens of KB. */
async function syncMarks(projectId, marks) {
  const list = markList(marks);
  const now = new Date().toISOString();
  const rows = list.map((m) => ({ project_id: projectId, code: m.code, category: m.kind, name: m.name && m.name !== m.code ? m.name : null,
    description: m.desc || null, image: m.image || null, supplier: m.supplier || null, status: m.status || null,
    source: m.fromLli ? "lli" : "room list", updated_at: now }));
  const had = must(await supabase.from("byroom_marks").select("code").eq("project_id", projectId)).map((r) => r.code);
  for (let i = 0; i < rows.length; i += 8) must(await supabase.from("byroom_marks").upsert(rows.slice(i, i + 8), { onConflict: "project_id,code" }));
  const gone = had.filter((c) => !rows.some((r) => r.code === c));
  for (let i = 0; i < gone.length; i += 100) must(await supabase.from("byroom_marks").delete().eq("project_id", projectId).in("code", gone.slice(i, i + 100)));
  return rows.length;
}
let syncMarksNow = null;          // set by the admin screen: every upload first tells the job which marks exist

/** What the client sees, read through the signed-in user's own permissions: only the published copy. */
export function tablesApi(projectId, projectName) {
  const pub = async (f) => must(await supabase.from("byroom_published").select("data").eq("project_id", projectId).eq("floor", f).eq("current", true).limit(1)).at(0)?.data;
  const marksOf = async (codes, full) => codes.length ? new Map(must(await supabase.from("byroom_marks")
    .select(full ? "code, category, name, description, image, supplier, status" : "code, name").eq("project_id", projectId).in("code", codes)).map((m) => [m.code, m])) : new Map();
  return {
    home: async () => {
      const proj = must(await supabase.from("byroom_projects").select("name, meta").eq("project_id", projectId).limit(1)).at(0);
      const pubs = must(await supabase.from("byroom_published").select("floor, data").eq("project_id", projectId).eq("current", true));
      return { project: { name: proj?.name ?? projectName, ...(proj?.meta ?? {}) },
        floors: pubs.map((p) => ({ floor: p.floor, rooms: (p.data?.rooms ?? []).map((r) => ({ n: r.n, name: r.name })) })).sort((a, b) => Number(a.floor) - Number(b.floor)) };
    },
    floor: async (f) => {
      const d = await pub(f); if (!d) return { map: null, rooms: [] };
      const by = await marksOf([...new Set(d.rooms.flatMap((r) => r.items.map((i) => i.code.toUpperCase())))], false);
      return { map: d.map, rooms: d.rooms.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, name: by.get(i.code.toUpperCase())?.name ?? null })) })) };
    },
    room: async (f, n) => {
      const d = await pub(f); const r = d?.rooms.find((x) => x.n.toLowerCase() === String(n).toLowerCase());
      if (!r) return { room: null };
      const by = await marksOf(r.items.map((i) => i.code.toUpperCase()), true);
      return { room: { ...r, items: r.items.map((i) => { const m = by.get(i.code.toUpperCase()); return { ...i, name: m?.name ?? null, description: m?.description ?? null, image: m?.image ?? null, supplier: m?.supplier ?? null, status: m?.status ?? null }; }) } };
    },
  };
}

// ----------------------------------------------------------------------------- רשימת חדרים
const sortRooms = (a, b) => { const x = /^(\d+)(.*)$/.exec(a.room_no), y = /^(\d+)(.*)$/.exec(b.room_no);
  return (x && y ? Number(x[1]) - Number(y[1]) || x[2].localeCompare(y[2]) : a.room_no.localeCompare(b.room_no)); };
const kindOrder = (a, b) => { const o = ["FL", "FN", "CL", "lighting"]; const x = o.indexOf(a), y = o.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b); };

/** A code in the room list with no LLI details: is it in the LLI at all, only not ticked BY ROOM? (build 9)
 *  lliAll = { "F-2": { ticked: false, rows: [...] } } from the dashboard, keyed by the LLI type mark. */
const canonMark = (c) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9\u0590-\u05FF]/g, "");
function lliFind(lliAll, code) {
  if (!lliAll) return null;
  const up = String(code ?? "").trim().toUpperCase();
  if (lliAll[up]) return { mark: up, ...lliAll[up] };
  const c = canonMark(up);
  const k = Object.keys(lliAll).find((x) => canonMark(x) === c);
  return k ? { mark: k, ...lliAll[k] } : null;
}

function MarkLine({ projectId, kind, code, lookup, manual, onRemove, lliAll, onTickByRoom, variants = [], onPick, meta, onMeta, editsOk, onEdited }) {
  const m = lookup(kind, code);
  const hit = !m ? lliFind(lliAll, code) : null;
  const [edit, setEdit] = useState(null);                   // {name, desc} while editing the wording
  const [note, setNote] = useState(meta?.note ?? "");
  const [noteSt, setNoteSt] = useState(null);
  useEffect(() => { setNote(meta?.note ?? ""); }, [meta?.updated_at, code]);
  const saveNote = async () => {
    if (note === (meta?.note ?? "")) return;
    setNoteSt("saving"); const ok = await onMeta({ note: note.trim() }); setNoteSt(ok ? "saved" : null); if (ok) setTimeout(() => setNoteSt(null), 1500);
  };
  const saveEdit = async () => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("byroom_mark_edits").upsert({ project_id: projectId, code: String(code).trim().toUpperCase(), name: edit.name.trim() || null,
      description: edit.desc, updated_at: new Date().toISOString(), updated_email: u?.user?.email ?? null }, { onConflict: "project_id,code" });
    if (error) { alert("לא נשמר: " + error.message); return; }
    setEdit(null); onEdited?.();
  };
  const resetEdit = async () => {
    if (!confirm(`להחזיר את ${code} לנוסח שב-LLI?`)) return;
    const { error } = await supabase.from("byroom_mark_edits").delete().eq("project_id", projectId).eq("code", String(code).trim().toUpperCase());
    if (error) { alert(error.message); return; }
    setEdit(null); onEdited?.();
  };
  const v = !!meta?.verified;
  return html`<div className=${"bra-mkrow" + (v ? " ver" : "")}>
    <div className="bra-mkside">
      ${onMeta ? html`<button type="button" className=${"bra-vc" + (v ? " on" : "")} title=${v ? `אומת 100%${meta.verified_email ? " · " + meta.verified_email : ""}${meta.verified_at ? " · " + fmtDate(meta.verified_at) : ""} — לחיצה מבטלת` : "סימון: בדקתי — האיפיון הזה שייך לחדר הזה ב-100%"}
        onClick=${() => onMeta({ verified: !v })}>✓</button>` : null}
      ${onRemove ? html`<button type="button" className="bra-trash" title="הסרת האיפיון מהחדר" aria-label="הסרת האיפיון מהחדר" onClick=${onRemove}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg></button>` : null}
    </div>
    ${m?.image ? html`<img src=${m.image} alt="" />` : html`<div className="noimg" />`}
    <div style=${{ flex: 1, minWidth: 0 }}>
      <div><b dir="ltr">${code}</b>${m?.name && m.name !== code && !edit ? html` · ${m.name}` : null}${m?.fromLli ? html`<span className="bra-tag">LLI</span>` : null}${m?.edited ? html`<span className="bra-tag" style=${{ color: "#8a5a00", background: "#fff1d6" }} title=${`נערך ב-By Room${m.edited.by ? " · " + m.edited.by : ""}${m.edited.at ? " · " + fmtDate(m.edited.at) : ""} — ה-LLI לא השתנה`}>נערך</span>` : null}${manual ? html`<span className="bra-tag" style=${{ color: "#8a3f07", background: "#f7efe3" }}>נוסף ידנית</span>` : null}
        ${m && !edit && editsOk ? html`<button type="button" className="bra-link" title="עריכת השם והתיאור ב-By Room בלבד — ה-LLI לא משתנה" onClick=${() => setEdit({ name: m.name && m.name !== code ? m.name : "", desc: m.desc ?? "" })}>✎ עריכה</button>` : null}</div>
      ${edit ? html`<div className="bra-edit">
          <input value=${edit.name} placeholder="שם האיפיון" onInput=${(e) => setEdit({ ...edit, name: e.target.value })} />
          <textarea rows="3" value=${edit.desc} placeholder="תיאור" onInput=${(e) => setEdit({ ...edit, desc: e.target.value })} />
          <div style=${{ fontSize: "12px", color: "#5b5e66" }}>השינוי חל על ${code} בכל החדרים ב-By Room, בדוחות ובקישור ללקוח (אחרי פרסום). ה-LLI לא משתנה.</div>
          <div className="bra-row" style=${{ gap: "6px" }}><button className="bra-btn small primary" onClick=${saveEdit}>שמירה</button><button className="bra-btn small" onClick=${() => setEdit(null)}>ביטול</button>
            ${m?.edited ? html`<button className="bra-btn small" onClick=${resetEdit}>חזרה לנוסח ה-LLI</button>` : null}</div>
          ${m?.edited && (m.lliDesc || m.lliName) ? html`<div style=${{ fontSize: "12px", color: "#9a9da5", whiteSpace: "pre-wrap" }}>בנוסח ה-LLI: ${m.lliName && m.lliName !== code ? m.lliName + " · " : ""}${m.lliDesc ?? ""}</div>` : null}
        </div>`
      : html`${m?.desc ? html`<div style=${{ fontSize: "13px", color: "#3b3e45", whiteSpace: "pre-wrap" }}>${m.desc}</div>` : null}
      ${m?.supplier ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>ספק: ${m.supplier}</div>` : null}`}
      ${!m ? (hit && !hit.ticked ? html`<div style=${{ fontSize: "12px", color: "#8a6d1f" }}>קיים ב-LLI${hit.mark !== String(code).trim().toUpperCase() ? ` (${hit.mark})` : ""} אבל לא מסומן BY ROOM
          ${onTickByRoom ? html` <button className="bra-btn small" style=${{ marginInlineStart: "6px" }} onClick=${() => onTickByRoom(hit.mark)}>סימון BY ROOM</button>` : null}</div>`
        : html`<div style=${{ fontSize: "12px", color: "#9a9da5" }}>לא קיים ב-LLI — אין שורה עם האיפיון הזה</div>`) : null}
      ${!m && onPick ? html`<${Variants} list=${variants} onPick=${onPick} />` : null}
    </div>
    ${onMeta ? html`<div className="bra-mknote">
      <textarea rows="2" value=${note} placeholder="הערה לאיפיון בחדר הזה" onInput=${(e) => setNote(e.target.value)} onBlur=${saveNote} />
      <div className="st">${noteSt === "saving" ? "שומר…" : noteSt === "saved" ? html`<span style=${{ color: "#1f7a3a" }}>נשמר</span>` : note !== (meta?.note ?? "") ? "יישמר ביציאה מהשדה" : ""}</div>
    </div>` : null}
  </div>`;
}

/** What changed in one room, newest first: from the approval log (V) and the hand additions. */
function describe(i) {
  const isMark = !["room", "name", "area", "boundary"].includes(i.field);
  if (isMark) {
    const b = Array.isArray(i.before) ? i.before : i.before?.codes ?? [], a = i.after?.codes ?? [];
    const add = a.filter((x) => !b.includes(x)), rem = b.filter((x) => !a.includes(x));
    if (add.length === 1 && rem.length === 1) return `${catHe(i.field)}: ${rem[0]} → ${add[0]}`;
    return [add.length ? `${add.join(", ")} נוסף` : "", rem.length ? `${rem.join(", ")} הוסר` : ""].filter(Boolean).join(" · ") || `${catHe(i.field)} אושר ללא שינוי`;
  }
  if (i.field === "name") return `שם החדר: ${i.before?.name ?? "—"} → ${i.after?.value ?? "—"}`;
  if (i.field === "area") return `שטח: ${i.after?.value ?? "—"} מ"ר`;
  if (i.field === "boundary") return "גבול החדר עודכן";
  return i.after?.value == null ? "החדר הוסר" : "החדר נוסף";
}

function RecentChanges({ projectId, floor, room }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { (async () => {
    const ap = must(await supabase.from("byroom_room_approvals").select("approved_at, approved_email, set_id, items").eq("project_id", projectId).eq("floor", floor).order("approved_at", { ascending: false }).limit(200));
    const sets = new Map(must(await supabase.from("byroom_plan_sets").select("id, name, revision").eq("project_id", projectId)).map((s) => [s.id, s]));
    const ids = ap.flatMap((a) => a.items.filter((i) => i.room === room && i.id).map((i) => i.id));
    const src = ids.length ? new Map(must(await supabase.from("byroom_room_review").select("id, sources").in("id", ids)).map((r) => [r.id, r.sources])) : new Map();
    const out = [];
    for (const a of ap) for (const i of a.items) if (i.room === room) {
      const s = sets.get(a.set_id);
      const from = i.manual ? `ידני · ${a.approved_email ?? ""}` : [...new Set((src.get(i.id) ?? []).map((x) => x.src))].join(" · ") || "תוכניות";
      out.push({ at: a.approved_at, what: describe(i), version: s ? `${s.name}${s.revision ? ` (${s.revision})` : ""}` : "—", from });
    }
    setRows(out.slice(0, 30));
  })(); }, [projectId, floor, room]);
  if (!rows) return html`<p>…</p>`;
  if (!rows.length) return html`<p style=${{ color: "#9a9da5", fontSize: "13px" }}>אין עדיין שינויים מתועדים לחדר הזה.</p>`;
  return html`<table style=${{ fontSize: "13px" }}><thead><tr><th>מה השתנה</th><th>תאריך</th><th>גרסה</th><th>מקור</th></tr></thead>
    <tbody>${rows.map((r, k) => html`<tr key=${k}><td dir="auto">${r.what}</td><td>${fmtDate(r.at)}</td><td>${r.version}</td><td>${r.from}</td></tr>`)}</tbody></table>`;
}

function AddMark({ projectId, room, catalog, onDone }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("FL");
  const [busy, setBusy] = useState(false);
  const known = catalog.find((m) => m.code === code.trim().toUpperCase());
  const kinds = [["FL", "ריצוף"], ["FN", "חיפוי קירות"], ["CL", "תקרה"], ...CATS.filter((c) => !KIND_OF_CAT[c.key]).map((c) => [kindOfCat(c.key), c.he])];
  const add = async () => {
    setBusy(true);
    try { must(await supabase.rpc("byroom_set_mark", { p_project: projectId, p_floor: room.floor, p_room: room.room_no, p_kind: known?.kind ?? kind, p_code: code, p_add: true })); setCode(""); onDone(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  return html`<div className="bra-row" style=${{ marginTop: "10px", padding: "10px", background: "#fff", border: "1px dashed #cfd2d8", borderRadius: "10px", justifyContent: "center" }}>
    <b style=${{ fontSize: "13px" }}>הוספת איפיון לחדר:</b>
    <input list="bra-marks" placeholder="קוד, למשל FL-7A" value=${code} onInput=${(e) => setCode(e.target.value)} style=${{ width: "150px" }} dir="ltr" />
    <datalist id="bra-marks">${catalog.map((m) => html`<option key=${m.code} value=${m.code}>${m.name ?? ""}</option>`)}</datalist>
    ${known ? html`<span style=${{ fontSize: "13px" }}>${catHe(known.kind)}${known.name && known.name !== known.code ? ` · ${known.name}` : ""}</span>`
      : html`<select value=${kind} onChange=${(e) => setKind(e.target.value)}>${kinds.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`}
    <button className="bra-btn primary small" disabled=${!code.trim() || busy} onClick=${add}>הוספה</button>
    <span style=${{ fontSize: "12px", color: "#5b5e66" }}>נרשם ביומן, ומגיע ללקוח בפרסום הבא.</span>
  </div>`;
}

// ----------------------------------------------------------------------------- export: Excel and PDF (build 9)
// Everything, each row with its state: published · approved, not yet published · waiting for approval in a version.
const ST_PUB = "פורסם", ST_APPROVED = "אושר — טרם פורסם";
async function allRows(q) {          // past the 1000-row page of the API
  const out = [];
  for (let from = 0; ; from += 1000) { const r = must(await q().range(from, from + 999)); out.push(...r); if (r.length < 1000) return out; }
}
async function exportRows({ projectId, rooms, floor, unpublished, lookup, notes = new Map(), meta = new Map() }) {
  const rows = [];
  const detail = (kind, code) => { const m = lookup(kind, code); return { mname: m?.name && m.name !== code ? m.name : "", desc: m?.desc ?? "", supplier: m?.supplier ?? "", lli: m?.status ?? "", image: m?.image ?? null }; };
  const have = new Set();
  for (const r of rooms) {
    const st = unpublished(r) ? ST_APPROVED : ST_PUB;
    if (!r.fin.length) rows.push({ floor: r.floor, room: r.room_no, name: r.name ?? "", area: r.area, kind: "", code: "", src: "", state: st, mname: "", desc: "", supplier: "", lli: "", image: null });
    for (const f of r.fin) {
      have.add(r.floor + "|" + r.room_no + "|" + f.kind + "|" + f.code.toUpperCase());
      rows.push({ floor: r.floor, room: r.room_no, name: r.name ?? "", area: r.area, kind: f.kind, code: f.code, src: f.source === "manual" ? "ידני" : "תוכנית", state: st, ...detail(f.kind, f.code) });
    }
  }
  // waiting for approval: the newest version of each floor that is still under review
  const sets = must(await supabase.from("byroom_plan_sets").select("id, floor, name, revision, created_at").eq("project_id", projectId)
    .in("status", ["review", "partly_approved"]).order("created_at"));
  const newest = new Map(); for (const x of sets) if (!floor || x.floor === floor) newest.set(x.floor, x);
  const known = new Map(rooms.map((r) => [r.floor + "|" + r.room_no, r]));
  for (const set of newest.values()) {
    const rr = await allRows(() => supabase.from("byroom_room_review").select("id, room_no, field, proposed, decision, change_type").eq("set_id", set.id).order("id"));
    const last = new Map(); for (const x of rr) last.set(x.room_no + "|" + x.field, x);
    const items = [...last.values()].filter((x) => x.decision === "pending" && x.change_type !== "same" && x.change_type !== "removed");
    const names = new Map(items.filter((x) => x.field === "name").map((x) => [x.room_no, x.proposed?.value ?? ""]));
    const state = `ממתין לאישור · ${set.name}${set.revision ? " " + set.revision : ""}`;
    for (const x of items) {
      if (["room", "name", "area", "boundary"].includes(x.field)) continue;
      const room = known.get(set.floor + "|" + x.room_no);
      for (const code of x.proposed?.codes ?? []) {
        if (have.has(set.floor + "|" + x.room_no + "|" + x.field + "|" + String(code).toUpperCase())) continue;
        rows.push({ floor: set.floor, room: x.room_no, name: room?.name ?? names.get(x.room_no) ?? "", area: room?.area ?? null, kind: x.field, code, src: "תוכנית", state, ...detail(x.field, code) });
      }
    }
  }
  for (const r of rows) {
    r.note = notes.get(r.floor + "|" + r.room)?.note ?? "";
    const mt = r.code ? meta.get(r.floor + "|" + r.room + "|" + r.kind + "|" + String(r.code).toUpperCase()) : null;
    r.mnote = mt?.note ?? ""; r.verified = !!mt?.verified;
  }
  const n = (s) => { const m = /^(\d+)(.*)$/.exec(s ?? ""); return m ? [Number(m[1]), m[2]] : [1e9, s ?? ""]; };
  return rows.sort((a, b) => Number(a.floor) - Number(b.floor) || n(a.room)[0] - n(b.room)[0] || String(n(a.room)[1]).localeCompare(n(b.room)[1])
    || kindOrder(a.kind || "zz", b.kind || "zz") || String(a.code).localeCompare(String(b.code), "en", { numeric: true }));
}
async function exportXlsx(rows, title) {
  const mod = await import("xlsx");
  const X = mod.utils ? mod : mod.default;
  const head = ["קומה", "מספר חדר", "שם החדר", 'שטח (מ"ר)', "קטגוריה", "מס' איפיון", "שם האיפיון", "תיאור", "ספק", "סטטוס LLI", "מקור", "מצב", "אומת ✓", "הערה לאיפיון", "הערות כלליות לחדר"];
  const data = [head, ...rows.map((r) => [r.floor, r.room, r.name, r.area != null ? Number(r.area) : "", r.kind ? catHe(r.kind) : "", r.code, r.mname, r.desc, r.supplier, r.lli, r.src, r.state, r.verified ? "✓" : "", r.mnote, r.note])];
  const ws = X.utils.aoa_to_sheet(data);
  ws["!cols"] = [6, 10, 22, 9, 14, 12, 22, 50, 18, 14, 9, 26, 8, 30, 40].map((w) => ({ wch: w }));
  ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: head.length - 1 } }) };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "By Room");
  wb.Workbook = { Views: [{ RTL: true }] };
  X.writeFile(wb, title.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx");
}
/** PDF in the A. Weiss format (build 11): one room per page; the A. Weiss logo on the right, floor and room on the
 *  left, no other logo. Opens the print window; "שמירה כ-PDF" there saves it. */
function exportPdf(rows, title, projectName, brand, floor) {
  const rooms = new Map();
  for (const r of rows) { const k = r.floor + "|" + r.room; if (!rooms.has(k)) rooms.set(k, { ...r, items: [] }); if (r.code) rooms.get(k).items.push(r); }
  const badge = (st) => `<span class="st ${st === ST_PUB ? "pub" : st === ST_APPROVED ? "ok" : "wait"}">${esc(st)}</span>`;
  const logo = brand?.brandLogo ? `<img class="logo" src="${esc(brand.brandLogo)}" alt="">` : `<b class="logo-t">א. וייס הנדסה</b>`;
  const today = new Date().toLocaleDateString("he-IL");
  const pages = [...rooms.values()].map((r) => {
    const kinds = [...new Set(r.items.map((i) => i.kind))].sort(kindOrder);
    const body = kinds.map((k) => `<h3>${esc(catHe(k))}</h3><table><thead><tr><th class="v"></th><th class="code">מס' איפיון</th><th>איפיון</th><th class="img">תמונה</th><th class="nt">הערה</th></tr></thead><tbody>${r.items.filter((i) => i.kind === k).map((i) => `<tr>
      <td class="v">${i.verified ? '<span class="ok">✓</span>' : ""}</td>
      <td class="code" dir="ltr">${esc(i.code)}</td>
      <td class="txt">${i.mname ? `<b>${esc(i.mname)}</b>` : ""}${i.desc ? `<div>${esc(i.desc).replace(/\n/g, "<br>")}</div>` : ""}${i.supplier ? `<div class="sup">ספק: ${esc(i.supplier)}</div>` : ""}${i.state !== ST_PUB ? `<div>${badge(i.state)}</div>` : ""}</td>
      <td class="img">${i.image ? `<img src="${esc(i.image)}" alt="">` : ""}</td>
      <td class="nt">${esc(i.mnote).replace(/\n/g, "<br>")}</td></tr>`).join("")}</tbody></table>`).join("");
    return `<section class="page">
      <header><div class="r">${logo}</div><div class="c"><div class="pn">${esc(projectName)}</div><div class="sub">חומרי גמר לפי חדר</div></div>
        <div class="l"><div class="fl">קומה ${esc(r.floor)}</div><div class="rn" dir="ltr">${esc(r.room)}</div></div></header>
      <div class="rname">${esc(r.name)}${r.area ? ` <small>· ${Number(r.area)} מ"ר</small>` : ""}</div>
      ${body || '<p class="none">אין איפיונים לחדר הזה</p>'}
      ${r.note ? `<div class="gnote"><b>הערות כלליות:</b><div>${esc(r.note).replace(/\n/g, "<br>")}</div></div>` : ""}
      <footer>א. וייס הנדסה · ${esc(projectName)} · ${today}</footer>
    </section>`;
  }).join("");
  printPage(title, `<style>
    @page{size:A4;margin:12mm}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{break-after:page;page-break-after:always;position:relative;min-height:268mm;padding-bottom:10mm;box-sizing:border-box}
    .page:last-child{break-after:auto;page-break-after:auto}
    header{display:flex;align-items:center;justify-content:space-between;border-bottom:2.5px solid #14181f;padding-bottom:4mm;margin-bottom:5mm}
    header .r,header .l{width:55mm}header .l{text-align:left}header .c{flex:1;text-align:center}
    .logo{max-height:18mm;max-width:55mm;object-fit:contain}.logo-t{font-size:16px}
    .pn{font-size:18px;font-weight:700}.sub{font-size:12px;color:#5b5e66}
    .fl{font-size:13px;color:#5b5e66}.rn{font-size:30px;font-weight:800;line-height:1.1}
    .rname{font-size:18px;font-weight:700;margin-bottom:3mm}.rname small{font-weight:400;color:#5b5e66;font-size:13px}
    h3{font-size:14px;margin:5mm 0 1.5mm;padding:1mm 2mm;background:#eef1f5;border-radius:1.5mm}
    table{width:100%;border-collapse:collapse}th{font-size:10.5px;color:#5b5e66;text-align:right;font-weight:600;border-bottom:1px solid #c9ccd2;padding:1mm 1.5mm}
    td{vertical-align:top;padding:2mm 1.5mm;border-bottom:1px solid #e6e8ec;font-size:11.5px}
    .v{width:7mm;text-align:center}.ok{display:inline-block;width:5mm;height:5mm;border-radius:50%;background:#2e9e57;color:#fff;font-size:10px;line-height:5mm;text-align:center}
    td.code,th.code{width:22mm}td.code{font-weight:700}th.img,td.img{width:26mm}td.img img{width:24mm;height:24mm;object-fit:contain}th.nt,td.nt{width:40mm}td.nt{color:#3b3e45}
    .sup{color:#5b5e66;margin-top:1mm}.none{color:#9a9da5;font-size:12px}
    .gnote{margin-top:5mm;border:1px solid #c9ccd2;border-radius:2mm;padding:3mm;font-size:12px}
    .st{font-size:9.5px;border-radius:8px;padding:0 6px;white-space:nowrap}.st.ok{background:#e7eef8;color:#1d5fa8}.st.wait{background:#fff1d6;color:#8a5a00}
    footer{position:absolute;bottom:0;left:0;right:0;font-size:9.5px;color:#9a9da5;text-align:center;border-top:1px solid #e6e8ec;padding-top:1.5mm}
  </style>${pages}`);
}

// ----------------------------------------------------------------------------- room list helpers (build 10)
/** Variants of a code in the project: C-2 → C-2A, C-2B (a letter suffix; C-21 is not a variant of C-2). */
function variantsOf(code, catalog, lliAll) {
  const c = canonMark(code);
  if (!c) return [];
  const pool = new Map();
  for (const m of catalog) pool.set(canonMark(m.code), m.code);
  for (const k of Object.keys(lliAll || {})) if (!pool.has(canonMark(k))) pool.set(canonMark(k), k.trim());
  return [...pool].filter(([k]) => k !== c && k.startsWith(c) && /^[A-Z][A-Z0-9]?$/.test(k.slice(c.length)))
    .map(([, v]) => v).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}
/** Remember "in this room the plan's C-2 is C-2A": the processing job proposes it in later versions. */
async function saveChoice(projectId, floor, room, kind, from, to) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("byroom_mark_choices").upsert({ project_id: projectId, floor, room_no: room, kind, from_code: from, to_code: to,
    chosen_at: new Date().toISOString(), chosen_email: u?.user?.email ?? null }, { onConflict: "project_id,floor,room_no,kind,from_code" });
  if (error) alert("ההחלפה נעשתה, אבל הבחירה לא נשמרה לגרסאות הבאות (צריך להריץ ב-Supabase את 003_notes_choices.sql): " + error.message);
}
const Variants = ({ list, onPick }) => list.length ? html`<div style=${{ fontSize: "12px", marginTop: "3px" }}>
  <span style=${{ color: "#1d5fa8" }}>אולי התכוונת ל: </span>${list.map((v) => html`<button key=${v} className="bra-btn small" dir="ltr" style=${{ marginInlineStart: "4px" }}
    title="החלפה לאיפיון הזה בחדר הזה — והבחירה נזכרת בגרסאות הבאות" onClick=${() => onPick(v)}>${v}</button>`)}</div>` : null;

/** One proposal waiting for V, inside the room list. */
function PendingLine({ it, ticked, onToggle, lookup, catalog, lliAll, onPick }) {
  const p = it.proposed || {}, c = it.current || {};
  const isMark = !["room", "name", "area", "boundary"].includes(it.field);
  const codes = isMark ? p.codes || [] : [];
  const val = isMark ? null : it.field === "boundary" ? (p.poly ? "גבול נסגר" : "גבול לא נסגר") : it.field === "room" ? (it.change_type === "removed" ? "החדר לא נמצא בגרסה" : it.change_type === "new" ? "חדר חדש" : "קיים") : (p.value ?? "—");
  const cur = it.change_type === "changed" ? (isMark ? (c.codes || []).join(", ") : c.value) : null;
  return html`<div className="bra-pline">
    <input type="checkbox" checked=${ticked} onChange=${onToggle} />
    <div style=${{ flex: 1 }}>
      <div><b>${catHe(it.field)}</b> · ${isMark ? (codes.length ? codes.map((x, i) => { const m = lookup(it.field, x); return html`<span key=${x}>${i ? ", " : ""}<b dir="ltr">${x}</b>${m?.name && m.name !== x ? ` ${m.name}` : ""}</span>`; }) : "—") : String(val)}
        <span style=${{ marginInlineStart: "6px" }}>${pill(it.status)}</span> <span style=${{ fontSize: "12px", color: "#5b5e66" }}>${CHANGE[it.change_type] ?? ""} · ${it.set.name}${it.set.revision ? " " + it.set.revision : ""}</span></div>
      ${cur != null && cur !== "" ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>היום: ${String(cur)}</div>` : null}
      ${it.note ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>${it.note}</div>` : null}
      ${codes.filter((x) => !lookup(it.field, x)).map((x) => html`<div key=${x}><${Variants} list=${variantsOf(x, catalog, lliAll)} onPick=${(v) => onPick(it, x, v)} /></div>`)}
    </div>
  </div>`;
}

function RoomsTab({ projectId, projectName, marks, brand, lliAll, onTickByRoom, editsOk, onEdited, L }) {
  const [rooms, setRooms] = useState(null);
  const [pend, setPend] = useState(new Map());
  const [notes, setNotes] = useState(new Map());
  const [notesOk, setNotesOk] = useState(true);
  const [meta, setMeta] = useState(new Map());              // per mark in a room: note + green V (build 11)
  const [metaOk, setMetaOk] = useState(true);
  const [pubAt, setPubAt] = useState(null);
  const [floor, setFloor] = useState("");
  const [q, setQ] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [open, setOpen] = useState(null);
  const [recent, setRecent] = useState(false);
  const [mapFloor, setMapFloor] = useState(null);
  const [map, setMap] = useState(null);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(null);
  const lookup = useMemo(() => markIndex(marks), [marks]);
  const catalog = useMemo(() => markList(marks), [marks]);
  useEffect(() => { (async () => {
    const r = must(await supabase.from("byroom_rooms").select("id, floor, room_no, name, area, updated_at").eq("project_id", projectId).eq("status", "active"));
    const ids = r.map((x) => x.id);
    const f = [];
    for (let i = 0; i < ids.length; i += 300) f.push(...must(await supabase.from("byroom_room_finishes").select("room_id, kind, code, source").in("room_id", ids.slice(i, i + 300))));
    setPubAt(must(await supabase.from("byroom_projects").select("published_at").eq("project_id", projectId).limit(1)).at(0)?.published_at ?? null);
    // waiting for V: the newest version of each floor that is still under review
    const sets = must(await supabase.from("byroom_plan_sets").select("id, floor, name, revision, created_at").eq("project_id", projectId).in("status", ["review", "partly_approved"]).order("created_at"));
    const newest = new Map(); for (const x of sets) newest.set(x.floor, x);
    const pm = new Map();
    for (const st of newest.values()) {
      const rr = await allRows(() => supabase.from("byroom_room_review").select("id, set_id, room_no, field, proposed, current, change_type, status, note, decision").eq("set_id", st.id).order("id"));
      const last = new Map(); for (const x of rr) last.set(x.room_no + "|" + x.field, x);
      for (const x of last.values()) if (x.decision === "pending") { const k = st.floor + "|" + x.room_no; if (!pm.has(k)) pm.set(k, []); pm.get(k).push({ ...x, set: st }); }
    }
    const { data: nd, error: ne } = await supabase.from("byroom_room_notes").select("floor, room_no, note, updated_at, updated_email").eq("project_id", projectId);
    setNotesOk(!ne);
    const { data: md, error: me } = await supabase.from("byroom_room_marks").select("floor, room_no, kind, code, note, verified, verified_at, verified_email, updated_at").eq("project_id", projectId);
    setMetaOk(!me);
    setMeta(new Map((md ?? []).map((x) => [x.floor + "|" + x.room_no + "|" + x.kind + "|" + String(x.code).toUpperCase(), x])));
    setNotes(new Map((nd ?? []).map((n) => [n.floor + "|" + n.room_no, n])));
    // a room the plans propose that is not approved yet still gets a row, so it can be ticked from here
    const rows = r.map((x) => ({ ...x, fin: f.filter((y) => y.room_id === x.id) }));
    const have = new Set(rows.map((x) => x.floor + "|" + x.room_no));
    for (const [k, items] of pm) if (!have.has(k)) {
      const [fl, no] = k.split("|");
      rows.push({ id: "p:" + k, floor: fl, room_no: no, name: items.find((i) => i.field === "name")?.proposed?.value ?? "", area: items.find((i) => i.field === "area")?.proposed?.value ?? null, fin: [], pendingOnly: true });
    }
    setPend(pm); setRooms(rows); setSel(new Set());
  })().catch((e) => alert(e.message)); }, [projectId, tick]);
  useEffect(() => { if (!mapFloor) return; (async () => {
    setMap(must(await supabase.from("byroom_floor_maps").select("data").eq("project_id", projectId).eq("floor", mapFloor).eq("approved", true).order("created_at", { ascending: false }).limit(1)).at(0)?.data ?? null);
  })(); }, [mapFloor, projectId]);
  useEffect(() => { setRecent(false); }, [open]);
  if (!rooms) return html`<p>…</p>`;
  if (!rooms.length) return html`<p>עדיין אין חדרים. מעלים תוכניות ב"${L.upload}", ואחרי העיבוד הם יופיעו כאן לאישור.</p>`;
  const key = (r) => r.floor + "|" + r.room_no;
  const mkey = (r, kind, code) => key(r) + "|" + kind + "|" + String(code).toUpperCase();
  const saveMeta = async (r, kind, code, patch) => {
    const cur = meta.get(mkey(r, kind, code));
    const { data: u } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const row = { project_id: projectId, floor: r.floor, room_no: r.room_no, kind, code: String(code).toUpperCase(), note: cur?.note ?? "", verified: !!cur?.verified,
      verified_at: cur?.verified_at ?? null, verified_email: cur?.verified_email ?? null, ...patch, updated_at: now };
    if ("verified" in patch) { row.verified_at = patch.verified ? now : null; row.verified_email = patch.verified ? u?.user?.email ?? null : null; }
    const { error } = await supabase.from("byroom_room_marks").upsert(row, { onConflict: "project_id,floor,room_no,kind,code" });
    if (error) { alert("לא נשמר: " + error.message + (metaOk ? "" : "\n(צריך להריץ ב-Supabase את 004_mark_edits.sql)")); return false; }
    setMeta((m) => new Map(m).set(mkey(r, kind, code), row));
    return true;
  };
  const pendOf = (r) => pend.get(key(r)) ?? [];
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const unpublished = (r) => !pubAt || new Date(r.updated_at) > new Date(pubAt);
  const qq = q.trim().toLowerCase();
  const list = rooms.filter((r) => (!floor || r.floor === floor) && (!onlyPending || pendOf(r).length) && (!qq || r.room_no.toLowerCase().includes(qq) || (r.name ?? "").toLowerCase().includes(qq)
    || (notes.get(key(r))?.note ?? "").toLowerCase().includes(qq)
    || r.fin.some((f) => f.code.toLowerCase().includes(qq) || (lookup(f.kind, f.code)?.name ?? "").toLowerCase().includes(qq)))).sort((a, b) => Number(a.floor) - Number(b.floor) || sortRooms(a, b));
  const codes = (r, k) => r.fin.filter((f) => f.kind === k).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const others = (r) => r.fin.filter((f) => !["FL", "FN", "CL"].includes(f.kind));
  const chip = (f, r) => { const m = lookup(f.kind, f.code); return html`<span className=${"bra-mk" + (m ? "" : " nodet") + (r && meta.get(mkey(r, f.kind, f.code))?.verified ? " ok" : "")} key=${f.kind + f.code} title=${m ? "" : "אין פירוט ב-LLI"}><b dir="ltr">${f.code}${f.source === "manual" ? "*" : ""}</b>${m?.name && m.name !== f.code ? html`<span>${m.name}</span>` : null}</span>`; };
  const cell = (r, k) => html`<td>${codes(r, k).map((f) => chip(f, r))}</td>`;
  const marksN = new Set(rooms.flatMap((r) => r.fin.map((f) => f.kind + "|" + f.code))).size;
  const shownPending = list.flatMap(pendOf);
  const toggle = (id) => setSel((t) => { const n = new Set(t); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approve = async () => {
    const all = [...pend.values()].flat().filter((i) => sel.has(i.id));
    const bySet = new Map(); for (const i of all) { if (!bySet.has(i.set_id)) bySet.set(i.set_id, []); bySet.get(i.set_id).push(i.id); }
    setBusy(true);
    try {
      let ok = 0, stale = 0;
      for (const [set, ids] of bySet) { const r = must(await supabase.rpc("byroom_approve_items", { p_set: set, p_ids: ids })); ok += r.approved || 0; if (!r.approved) stale += ids.length; }
      alert(`אושרו ${ok} שורות${stale ? ` · ${stale} כבר לא היו עדכניות (הייתה הצלבה חדשה) — הרשימה נטענה מחדש` : ""}`);
      setTick((t) => t + 1);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const doExport = async (kind) => {
    setExporting(kind);
    try {
      const rows = await exportRows({ projectId, rooms: list.filter((r) => !r.pendingOnly), floor, unpublished, lookup, notes, meta });
      if (!rows.length) { alert("אין מה לייצא בסינון הזה"); return; }
      const title = `By Room - ${projectName}${floor ? ` - קומה ${floor}` : ""} - ${new Date().toLocaleDateString("he-IL").replace(/\./g, "-")}`;
      if (kind === "xlsx") await exportXlsx(rows, title); else exportPdf(rows, title, projectName, brand, floor);
    } catch (e) { alert("הייצוא נכשל: " + e.message); }
    finally { setExporting(null); }
  };
  const remove = async (r, f) => {
    if (!confirm(`להסיר את ${f.code} מחדר ${r.room_no}?${f.source === "plan" ? "\nהאיפיון נקרא מהתוכניות — בגרסה הבאה הוא יוצע שוב לאישור." : ""}`)) return;
    try { must(await supabase.rpc("byroom_set_mark", { p_project: projectId, p_floor: r.floor, p_room: r.room_no, p_kind: f.kind, p_code: f.code, p_add: false })); setTick((t) => t + 1); }
    catch (e) { alert(e.message); }
  };
  // an approved code with no details whose variant was meant: swap it in the room, and remember the choice
  const pickApproved = async (r, kind, from, to) => {
    if (!confirm(`בחדר ${r.room_no}: להחליף את ${from} ב-${to}?\nהבחירה נזכרת — בגרסאות הבאות ${from} בחדר הזה יוצע כ-${to}.`)) return;
    try {
      must(await supabase.rpc("byroom_set_mark", { p_project: projectId, p_floor: r.floor, p_room: r.room_no, p_kind: kind, p_code: to, p_add: true }));
      must(await supabase.rpc("byroom_set_mark", { p_project: projectId, p_floor: r.floor, p_room: r.room_no, p_kind: kind, p_code: from, p_add: false }));
      await saveChoice(projectId, r.floor, r.room_no, kind, from, to);
      setTick((t) => t + 1);
    } catch (e) { alert(e.message); }
  };
  // a proposal waiting for V: change what will be approved, and remember the choice
  const pickPending = async (it, from, to) => {
    try {
      const codes = [...new Set((it.proposed?.codes ?? []).map((x) => (x === from ? to : x)))];
      must(await supabase.from("byroom_room_review").update({ proposed: { ...it.proposed, codes }, note: [it.note, `נבחר ${to} במקום ${from}`].filter(Boolean).join(" · ") }).eq("id", it.id));
      await saveChoice(projectId, it.set.floor, it.room_no, it.field, from, to);
      setTick((t) => t + 1);
    } catch (e) { alert(e.message); }
  };
  if (mapFloor) {
    const sel1 = rooms.find((r) => r.floor === mapFloor && r.id === open);
    return html`<div>
      <div className="bra-row" style=${{ marginBottom: "8px" }}><button className="bra-btn" onClick=${() => { setMapFloor(null); setMap(null); }}>${L.back}</button>
        ${floors.length > 1 ? html`<select value=${mapFloor} onChange=${(e) => setMapFloor(e.target.value)}>${floors.map((f) => html`<option key=${f} value=${f}>${L.floor} ${f}</option>`)}</select>` : html`<b>${L.floor} ${mapFloor}</b>`}
        ${sel1 ? html`<span>${L.room} <b>${sel1.room_no}</b> ${sel1.name ?? ""}</span>` : html`<span style=${{ color: "#5b5e66" }}>לחיצה על חדר במפה פותחת אותו ברשימה</span>`}</div>
      <div className="brv" style=${{ height: "calc(var(--appvh, 100vh) - 230px)", border: "1px solid #e6e6e9", borderRadius: "12px", overflow: "hidden" }}>
        <${FloorMap} map=${map} selected=${sel1?.room_no ?? null} onPick=${(n) => { const r = rooms.find((x) => x.floor === mapFloor && x.room_no === n); if (r) { setOpen(r.id); setMapFloor(null); setFloor(r.floor); setQ(""); } }} /></div></div>`;
  }
  return html`<div className="bra-rooms">
    <div className="bra-row" style=${{ marginBottom: "8px" }}>
      <select value=${floor} onChange=${(e) => setFloor(e.target.value)}><option value="">כל הקומות</option>${floors.map((f) => html`<option key=${f} value=${f}>${L.floor} ${f}</option>`)}</select>
      <input type="search" placeholder="חיפוש חדר, שם, איפיון או הערה" value=${q} onInput=${(e) => setQ(e.target.value)} style=${{ minWidth: "220px" }} />
      <label><input type="checkbox" checked=${onlyPending} onChange=${(e) => setOnlyPending(e.target.checked)} /> רק חדרים עם ממתינים</label>
      <span style=${{ color: "#5b5e66" }}>${list.length} חדרים · ${marksN} איפיונים${shownPending.length ? ` · ${shownPending.length} ממתינים לאישור` : ""}</span>
      <span style=${{ flex: 1 }} />
      <button className="bra-btn" disabled=${exporting} title="כל החדרים שבסינון: מה שפורסם, מה שאושר וטרם פורסם, ומה שממתין לאישור בגרסאות" onClick=${() => doExport("xlsx")}>${exporting === "xlsx" ? "מכין…" : "ייצוא לאקסל"}</button>
      <button className="bra-btn" disabled=${exporting} title="כרטיס לכל חדר — נפתח חלון הדפסה; לשמירה כ-PDF בוחרים 'שמירה כ-PDF'" onClick=${() => doExport("pdf")}>${exporting === "pdf" ? "מכין…" : "PDF"}</button>
      <button className="bra-btn" onClick=${() => setMapFloor(floor || floors[0])}>מפת קומה</button>
    </div>
    ${shownPending.length ? html`<div className="bra-row bra-approvebar">
      <b>אישור V מכאן:</b>
      <button className="bra-btn small" onClick=${() => setSel(new Set(shownPending.map((i) => i.id)))}>סימון הכל (${shownPending.length})</button>
      <button className="bra-btn small" onClick=${() => setSel(new Set(shownPending.filter((i) => i.status === "certain").map((i) => i.id)))}>${L.selectCertain}</button>
      <button className="bra-btn small" onClick=${() => setSel(new Set())}>${L.clear}</button>
      <span style=${{ flex: 1 }} /><b>${sel.size} מסומנות</b>
      <button className="bra-btn primary" disabled=${!sel.size || busy} onClick=${approve}>${busy ? "מאשר…" : L.approveSel}</button></div>` : null}
    <div className="bra-scroll"><table>
      <thead><tr><th>${L.floor}</th><th>${L.room}</th><th>שם החדר</th><th>${L.area}</th><th>${KIND.FL.he}</th><th>${KIND.FN.he}</th><th>${KIND.CL.he}</th><th>${FIELD_HE.other}</th><th>הערות</th></tr></thead>
      <tbody>${list.map((r) => { const on = open === r.id; const pp = pendOf(r); const nt = notes.get(key(r))?.note ?? ""; return html`<${React.Fragment} key=${r.id}>
        <tr className=${"rw" + (on ? " on" : "")} onClick=${() => setOpen(on ? null : r.id)}>
          <td>${r.floor}</td><td><span className="arr">${on ? "▲" : "▼"}</span> <b dir="ltr">${r.room_no}</b>
            ${pp.length ? html`<div><span className="bra-pend">${r.pendingOnly ? "חדר חדש · " : ""}${pp.length} ממתינים</span></div>` : null}</td>
          <td>${r.name ?? ""}</td><td>${r.area ? `${Number(r.area)} מ"ר` : ""}</td>
          ${cell(r, "FL")}${cell(r, "FN")}${cell(r, "CL")}<td>${others(r).map((f) => chip(f, r))}</td>
          <td className="ntc" title=${nt}>${nt}</td></tr>
        ${on ? html`<tr className="det"><td colSpan="9">
          ${pp.length ? html`<div className="bra-pbox"><div style=${{ fontWeight: 700, marginBottom: "4px" }}>ממתין לאישור (V)</div>
            ${pp.map((it) => html`<${PendingLine} key=${it.id} it=${it} ticked=${sel.has(it.id)} onToggle=${() => toggle(it.id)} lookup=${lookup} catalog=${catalog} lliAll=${lliAll} onPick=${pickPending} />`)}
            <div className="bra-row" style=${{ marginTop: "6px" }}><button className="bra-btn small" onClick=${() => setSel((t) => new Set([...t, ...pp.map((i) => i.id)]))}>סימון כל החדר</button>
              <button className="bra-btn primary small" disabled=${busy || !pp.some((i) => sel.has(i.id))} onClick=${approve}>${L.approveSel}</button></div></div>` : null}
          ${[...new Set(r.fin.map((f) => f.kind))].sort(kindOrder).map((k) => html`<div key=${k} style=${{ marginBottom: "8px" }}>
            <div style=${{ fontWeight: 700, color: "var(--accent-ink,#000)", margin: "4px 0" }}>${catHe(k)}</div>
            ${codes(r, k).map((f) => html`<${MarkLine} key=${f.code} projectId=${projectId} kind=${k} code=${f.code} lookup=${lookup} manual=${f.source === "manual"} onRemove=${() => remove(r, f)} lliAll=${lliAll} onTickByRoom=${onTickByRoom}
              variants=${lookup(k, f.code) ? [] : variantsOf(f.code, catalog, lliAll)} onPick=${(v) => pickApproved(r, k, f.code, v)}
              meta=${meta.get(mkey(r, k, f.code))} onMeta=${metaOk ? (patch) => saveMeta(r, k, f.code, patch) : null} editsOk=${editsOk} onEdited=${onEdited} />`)}</div>`)}
          ${!metaOk && r.fin.length ? html`<div style=${{ fontSize: "12px", color: "#8a6d1f" }}>V ירוק והערה לכל איפיון: צריך להריץ פעם אחת ב-Supabase את <code>004_mark_edits.sql</code>.</div>` : null}
          ${!r.fin.length && !r.pendingOnly ? html`<p style=${{ color: "#9a9da5" }}>אין איפיונים לחדר הזה.</p>` : null}
          ${r.pendingOnly ? html`<p style=${{ color: "#5b5e66" }}>החדר עדיין לא אושר — אחרי אישור V אפשר להוסיף לו איפיונים ידנית.</p>` : html`<${AddMark} projectId=${projectId} room=${r} catalog=${catalog} onDone=${() => setTick((t) => t + 1)} />`}
          <${RoomNote} projectId=${projectId} room=${r} note=${notes.get(key(r))} ok=${notesOk} onSaved=${(n) => setNotes((m) => new Map(m).set(key(r), n))} />
          <div style=${{ marginTop: "14px", display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
            ${r.pendingOnly ? null : html`<button className="bra-btn" style=${{ minWidth: "240px" }} onClick=${() => setRecent(!recent)}>${recent ? "▲ סגירת השינויים האחרונים" : "▼ שינויים אחרונים (Recent Changes)"}</button>`}
            <button className="bra-btn" style=${{ minWidth: "240px" }} onClick=${() => setMapFloor(r.floor)}>הצגה על מפת הקומה</button></div>
          ${recent && !r.pendingOnly ? html`<div style=${{ marginTop: "8px" }}><${RecentChanges} projectId=${projectId} floor=${r.floor} room=${r.room_no} /></div>` : null}
        </td></tr>` : null}
      </${React.Fragment}>`; })}</tbody></table></div>
    <p style=${{ fontSize: "12px", color: "#5b5e66", margin: "6px 0 0" }}>השם, התיאור, התמונה והספק של כל איפיון נמשכים מה-LLI (שורות BY ROOM). * = נוסף ידנית. איפיון בצבע חום עם קו מקווקו = אין לו פירוט ב-LLI.</p>
  </div>`;
}

/** The administrator's note on a room: saved on "שמירה", goes into the Excel / PDF report, not to the client. */
function RoomNote({ projectId, room, note, ok, onSaved }) {
  const [v, setV] = useState(note?.note ?? "");
  const [state, setState] = useState(null);
  useEffect(() => { setV(note?.note ?? ""); }, [room.floor, room.room_no, note?.updated_at]);
  const dirty = v !== (note?.note ?? "");
  const save = async () => {
    setState("saving");
    const { data: u } = await supabase.auth.getUser();
    const row = { project_id: projectId, floor: room.floor, room_no: room.room_no, note: v.trim(), updated_at: new Date().toISOString(), updated_email: u?.user?.email ?? null };
    const { error } = await supabase.from("byroom_room_notes").upsert(row, { onConflict: "project_id,floor,room_no" });
    if (error) { setState(null); alert("ההערה לא נשמרה: " + error.message); return; }
    onSaved(row); setState("saved"); setTimeout(() => setState(null), 1800);
  };
  if (!ok) return html`<div style=${{ marginTop: "10px", fontSize: "12px", color: "#8a6d1f" }}>הערות לחדר: צריך להריץ פעם אחת ב-Supabase את <code>003_notes_choices.sql</code>.</div>`;
  return html`<div style=${{ marginTop: "12px" }}>
    <div style=${{ fontWeight: 700, marginBottom: "4px" }}>הערות כלליות לחדר <span style=${{ fontWeight: 400, fontSize: "12px", color: "#5b5e66" }}>— נכנסות לדוח אקסל / PDF, לא מוצגות ללקוח</span></div>
    <textarea value=${v} rows="2" style=${{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: "13px" }} placeholder="למשל: נדרש לוודא גוון מול האדריכל"
      onClick=${(e) => e.stopPropagation()} onInput=${(e) => setV(e.target.value)} />
    <div className="bra-row" style=${{ gap: "8px", justifyContent: "center", marginTop: "6px" }}>
      <button className="bra-btn primary" style=${{ minWidth: "140px" }} disabled=${!dirty || state === "saving"} onClick=${save}>${state === "saving" ? "שומר…" : "שמירה"}</button>
      ${state === "saved" ? html`<span style=${{ color: "#1f7a3a", fontSize: "12px" }}>נשמר</span>` : dirty ? html`<span style=${{ color: "#8a6d1f", fontSize: "12px" }}>לא נשמר</span>` : null}
      ${note?.updated_at ? html`<span style=${{ color: "#5b5e66", fontSize: "12px" }}>עודכן ${fmtDate(note.updated_at)}${note.updated_email ? ` · ${note.updated_email}` : ""}</span>` : null}
    </div></div>`;
}

// ----------------------------------------------------------------------------- work files of one version
function WorkFiles({ setId, L }) {
  const [rows, setRows] = useState(null);
  const load = async () => setRows(must(await supabase.from("byroom_plan_files").select("*")
    .eq("set_id", setId).in("format", ["dxf", "rvt"]).neq("status", "removed").order("created_at")));
  useEffect(() => { load(); }, [setId]);
  if (!rows) return html`<p>…</p>`;
  if (!rows.length) return html`<p style=${{ color: "#5b5e66" }}>אין בגרסה הזו קובצי DXF או RVT.</p>`;
  const purge = async (ids) => {
    if (!ids.length || !confirm(`למחוק ${ids.length} קבצי עבודה? הנתונים המפוענחים וה-PDF נשמרים. אי אפשר לבטל.`)) return;
    try { await fn({ action: "purge", file_ids: ids }); load(); } catch (e) { alert(e.message); }
  };
  return html`<div>
    <p style=${{ fontSize: "13px", color: "#5b5e66" }}>${L.neverPdf}</p>
    <table><thead><tr><th>קובץ</th><th>${L.size}</th><th>${L.due}</th><th>${L.keep}</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.id}>
        <td>${r.original_name}</td><td>${fmtSize(r.size_bytes)}</td>
        <td>${r.purged_at ? `${L.purged} ${fmtDate(r.purged_at)}` : r.keep ? "—" : r.purge_after ? fmtDate(r.purge_after) : "30 יום אחרי אישור הגרסה"}</td>
        <td><input type="checkbox" disabled=${!!r.purged_at} checked=${r.keep} onChange=${async (e) => { must(await supabase.from("byroom_plan_files").update({ keep: e.target.checked }).eq("id", r.id)); load(); }} /></td>
        <td>${r.purged_at || r.keep ? null : html`<button className="bra-btn small" disabled=${!r.purge_after || new Date(r.purge_after) > Date.now()} title=${r.purge_after ? "" : "אפשר לנקות רק אחרי אישור הגרסה"} onClick=${() => purge([r.id])}>${L.purgeNow}</button>`}</td></tr>`)}</tbody></table>
  </div>`;
}

// ----------------------------------------------------------------------------- approval log of one version
function History({ setId, L }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { (async () => {
    setRows(must(await supabase.from("byroom_room_approvals").select("*").eq("set_id", setId).order("approved_at", { ascending: false })));
  })(); }, [setId]);
  if (!rows) return html`<p>…</p>`;
  if (!rows.length) return html`<p style=${{ color: "#5b5e66" }}>עדיין לא אושרו שינויים מהגרסה הזו. כל אישור V נרשם כאן: מתי, מי אישר ומה.</p>`;
  return html`<table><thead><tr><th>מתי</th><th>${L.approvedBy}</th><th>${L.items}</th><th>${L.leftPending}</th><th></th></tr></thead>
    <tbody>${rows.map((a) => html`<${React.Fragment} key=${a.id}><tr>
      <td>${fmtDate(a.approved_at)}</td><td>${a.approved_email ?? ""}</td><td>${a.items.length}</td><td>${a.left_pending}</td>
      <td><button className="bra-btn small" onClick=${() => setOpen(open === a.id ? null : a.id)}>${open === a.id ? "▲" : "▼"}</button></td></tr>
      ${open === a.id ? html`<tr><td colSpan="5" style=${{ background: "#fafafa", fontSize: "12px" }}>${a.items.map((i, k) => html`<div key=${k}>
        ${L.room} ${i.room} · ${catHe(i.field)}${i.manual ? (i.manual === "added" ? " · נוסף ידנית" : " · הוסר ידנית") : ""}: ${[].concat(i.after?.codes ?? i.after?.value ?? (i.after?.poly ? "גבול" : "")).join(", ")}</div>`)}</td></tr>` : null}
    </${React.Fragment}>`)}</tbody></table>`;
}

// ----------------------------------------------------------------------------- קישורים / QR
const projectMessage = (projectName, link) => [
  "שלום,",
  `מצורף קישור לצפייה בחומרי הגמר לפי חדר בפרויקט ${projectName}.`,
  "בקישור בוחרים קומה, מקישים על חדר במפה או מקלידים את מספר החדר, ורואים את האיפיונים המאושרים של החדר.",
  link,
  "",
  "בברכה,",
  "א. וייס הנדסה",
].join("\n");

function printPage(title, body) {
  const w = window.open("", "_blank");
  if (!w) { alert("הדפדפן חסם את חלון ההדפסה. אפשרו חלונות קופצים לאתר ונסו שוב."); return; }
  w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:Assistant,Arial,sans-serif;color:#17181c;margin:12mm}
    .poster{text-align:center;padding-top:10mm}.poster h1{font-size:30px;margin:0 0 4mm}.poster h2{font-size:20px;font-weight:500;margin:0 0 10mm;color:#5b5e66}
    .poster img{width:90mm;height:90mm}.poster p{font-size:17px;line-height:1.6;max-width:150mm;margin:8mm auto 0}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.q{border:1px solid #ccc;border-radius:3mm;padding:4mm;text-align:center;break-inside:avoid}
    .q img{width:42mm;height:42mm}.q b{display:block;font-size:16px}.q small{color:#5b5e66}
  </style></head><body>${body}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function QrLinks({ projectId, projectName, L }) {
  const [key, setKey] = useState(undefined);
  const [floors, setFloors] = useState([]);
  const [floor, setFloor] = useState(null);
  const [copied, setCopied] = useState(null);
  const base = new URL("./", import.meta.url).href;
  const load = async () => {
    setKey(must(await supabase.from("byroom_room_links").select("*").eq("project_id", projectId).is("revoked_at", null).order("created_at", { ascending: false }).limit(1)).at(0) ?? null);
    const fl = [...new Set(must(await supabase.from("byroom_rooms").select("floor").eq("project_id", projectId).eq("status", "active")).map((r) => r.floor))].sort((a, b) => Number(a) - Number(b));
    setFloors(fl); setFloor((f) => f ?? fl[0] ?? null);
  };
  useEffect(() => { load(); }, [projectId]);
  const url = (f, r) => `${base}?${new URLSearchParams({ k: key.token, ...(f ? { f } : {}), ...(r ? { r } : {}) })}`;
  const QR = async () => (await import("https://esm.sh/qrcode@1.5.4")).default;
  const make = async () => { must(await supabase.from("byroom_room_links").insert({ project_id: projectId, project_name: projectName })); load(); };
  const revoke = async () => { if (confirm("לבטל את המפתח? כל הקישורים וקודי ה-QR שנשלחו או הודפסו יפסיקו לעבוד.")) { must(await supabase.from("byroom_room_links").update({ revoked_at: new Date().toISOString() }).eq("id", key.id)); load(); } };
  if (key === undefined) return html`<p>…</p>`;
  if (!key) return html`<div className="bra-card"><p>${L.noKey}</p><p style=${{ fontSize: "13px", color: "#5b5e66" }}>המפתח הוא מה שפותח את הקישור לצפייה. אפשר לבטל אותו בכל רגע, וכל הקישורים יפסיקו לעבוד.</p>
    <button className="bra-btn primary" onClick=${make}>${L.makeKey}</button></div>`;
  const link = url(null, null);
  const msg = projectMessage(projectName, link);
  const copy = async (t, what) => { try { await navigator.clipboard.writeText(t); setCopied(what); setTimeout(() => setCopied(null), 1800); } catch (e) { prompt("העתיקו:", t); } };
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  const mail = () => window.open("https://outlook.office.com/mail/deeplink/compose?" + `subject=${encodeURIComponent(`פרויקט ${projectName} - חומרי גמר לפי חדר`)}&body=${encodeURIComponent(msg.replace(/\n/g, "\r\n"))}`, "_blank");
  const printProject = async () => {
    const img = await (await QR()).toDataURL(link, { margin: 1, width: 600 });
    printPage(`QR ${projectName}`, `<div class="poster"><h1>${esc(projectName)}</h1><h2>חומרי גמר לפי חדר</h2><img src="${img}" alt=""><p>סרקו את הקוד, בחרו קומה והקישו על חדר במפה כדי לראות את האיפיונים המאושרים שלו.</p></div>`);
  };
  const printRooms = async () => {
    const q = await QR();
    const rooms = must(await supabase.from("byroom_rooms").select("room_no, name").eq("project_id", projectId).eq("floor", floor).eq("status", "active")).sort(sortRooms);
    const cards = [];
    for (const r of rooms) cards.push(`<div class="q"><img src="${await q.toDataURL(url(floor, r.room_no), { margin: 1, width: 300 })}" alt=""><b>${L.room} ${esc(r.room_no)}</b><div>${esc(r.name)}</div><small>${esc(projectName)} · ${L.floor} ${esc(floor)}</small></div>`);
    printPage(`QR ${projectName} ${L.floor} ${floor}`, `<div class="grid">${cards.join("")}</div>`);
  };
  return html`<div>
    <div className="bra-card">
      <h3 style=${{ marginTop: 0 }}>ההודעה לפרויקט</h3>
      <div className="bra-msgbox">${msg}</div>
      <div className="bra-row" style=${{ marginTop: "10px" }}>
        <button className="bra-btn primary" onClick=${whatsapp}>שליחה בוואטסאפ</button>
        <button className="bra-btn primary" onClick=${mail}>שליחה במייל (Outlook)</button>
        <button className="bra-btn" onClick=${() => copy(msg, "msg")}>${copied === "msg" ? "הועתק ✓" : "העתקת ההודעה"}</button>
        <button className="bra-btn" onClick=${() => copy(link, "link")}>${copied === "link" ? "הועתק ✓" : "העתקת הקישור בלבד"}</button>
      </div>
    </div>
    <div className="bra-card">
      <h3 style=${{ marginTop: 0 }}>QR להדפסה</h3>
      <div className="bra-row">
        <button className="bra-btn" onClick=${printProject}>QR לפרויקט (דף אחד)</button>
        ${floors.length ? html`<span style=${{ marginInlineStart: "12px" }}>QR לכל חדר:</span>
          <select value=${floor ?? ""} onChange=${(e) => setFloor(e.target.value)}>${floors.map((f) => html`<option key=${f} value=${f}>${L.floor} ${f}</option>`)}</select>
          <button className="bra-btn" onClick=${printRooms}>הדפסת QR לחדרי הקומה</button>` : html`<span style=${{ color: "#5b5e66" }}>QR לכל חדר יופיע אחרי שיאושרו חדרים.</span>`}
      </div>
    </div>
    <div className="bra-row" style=${{ fontSize: "13px", color: "#5b5e66" }}>
      <span>${L.key} נוצר ב-${fmtDate(key.created_at)}. הקישור מציג רק נתונים מאושרים, לצפייה בלבד.</span>
      <button className="bra-btn small" onClick=${revoke}>${L.revoke}</button>
    </div>
  </div>`;
}

// ============================================================================= preview + publish
/** What the link WILL show once published: the approved layer as it is now, with the dashboard's own marks. */
function previewApi(projectId, projectName, marks, brand) {
  const lookup = markIndex(marks);
  const roomsOf = async (f) => {
    const rooms = must(await supabase.from("byroom_rooms").select("id, floor, room_no, name, area").eq("project_id", projectId).eq("status", "active").eq("floor", f));
    const ids = rooms.map((r) => r.id), fin = [];
    for (let i = 0; i < ids.length; i += 300) fin.push(...must(await supabase.from("byroom_room_finishes").select("room_id, kind, code").in("room_id", ids.slice(i, i + 300))));
    return rooms.map((r) => ({ n: r.room_no, name: r.name, area: r.area, items: fin.filter((x) => x.room_id === r.id).map((x) => ({ kind: x.kind, code: x.code })) }));
  };
  const full = (i) => { const m = lookup(i.kind, i.code); return { ...i, name: m?.name && m.name !== i.code ? m.name : null, description: m?.desc ?? null, image: m?.image ?? null, supplier: m?.supplier ?? null, status: m?.status ?? null }; };
  return {
    home: async () => {
      const r = must(await supabase.from("byroom_rooms").select("floor, room_no, name").eq("project_id", projectId).eq("status", "active"));
      const floors = [...new Set(r.map((x) => x.floor))].sort((a, b) => Number(a) - Number(b));
      return { project: { name: projectName, clientLogo: brand?.clientLogo, supervisionLogo: brand?.supervisionLogo, categories: CATS.map((c) => ({ key: kindOfCat(c.key), he: c.he })) },
        floors: floors.map((f) => ({ floor: f, rooms: r.filter((x) => x.floor === f).map((x) => ({ n: x.room_no, name: x.name })) })) };
    },
    floor: async (f) => {
      const map = must(await supabase.from("byroom_floor_maps").select("data").eq("project_id", projectId).eq("floor", f).eq("approved", true).order("created_at", { ascending: false }).limit(1)).at(0)?.data ?? null;
      return { map, rooms: (await roomsOf(f)).map((r) => ({ ...r, items: r.items.map(full) })) };
    },
    room: async (f, n) => {
      const r = (await roomsOf(f)).find((x) => x.n.toLowerCase() === String(n).toLowerCase());
      return { room: r ? { ...r, items: r.items.map(full) } : null };
    },
  };
}

async function publishNow(projectId, projectName, marks, brand) {
  if (!confirm(`לפרסם ללקוח את כל מה שאושר בפרויקט ${projectName}?\nמהרגע הזה הקישורים וקודי ה-QR יציגו את הנתונים המעודכנים.`)) return;
  try {
    await syncMarks(projectId, marks);
    const r = must(await supabase.rpc("byroom_publish", { p_project: projectId, p_meta: {
      name: projectName, clientLogo: brand?.clientLogo ?? null, supervisionLogo: brand?.supervisionLogo ?? null,
      categories: CATS.map((c) => ({ key: kindOfCat(c.key), he: c.he, en: c.en })) } }));
    alert(`פורסם: ${r.rooms} חדרים ב-${r.floors} קומות.`);
  } catch (e) { alert(e.message); }
}

// ============================================================================= the screen
// One toolbar, like the other boards: upload · versions · rooms · links / QR · preview. Publish sits at the bottom:
// upload, check the rooms, look at the preview, then publish (her order, 25.10.26).
export function ByRoomAdmin({ projectId, projectName, marks: lliMarks, categories, brand, lliAll, onTickByRoom, isRTL = true }) {
  const L = W.he;
  CATS = categories || [];
  // a mark's wording edited in By Room takes the place of the LLI wording here only (build 11)
  const [edits, setEdits] = useState(new Map());
  const [editsOk, setEditsOk] = useState(true);
  const loadEdits = async () => {
    const { data, error } = await supabase.from("byroom_mark_edits").select("code, name, description, updated_at, updated_email").eq("project_id", projectId);
    setEditsOk(!error); setEdits(new Map((data ?? []).map((e) => [String(e.code).toUpperCase(), e])));
  };
  useEffect(() => { loadEdits(); }, [projectId]);
  const marks = useMemo(() => mergeEdits(lliMarks, edits), [lliMarks, edits]);
  syncMarksNow = () => syncMarks(projectId, marks);
  const [tab, setTab] = useState("versions");
  const [openSet, setOpenSet] = useState(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const api = useMemo(() => previewApi(projectId, projectName, marks, brand), [projectId, projectName, marks, brand]);
  const tabs = [["upload", L.upload], ["versions", "גרסאות"], ["rooms", L.roomsList], ["qr", L.qr]];
  const on = { background: "#14181f", color: "#fff", borderColor: "#14181f" };
  return html`<div className="bra" dir="rtl">
    <style>${css}${viewCss}</style>
    <div className="lliBar bra-noprint" style=${{ marginBottom: "12px" }}>
      ${tabs.map(([k, t]) => html`<button key=${k} type="button" className="ghostBtn small" style=${tab === k ? on : undefined} onClick=${() => { setTab(k); setOpenSet(null); }}>${t}</button>`)}
      <button type="button" className="ghostBtn small" onClick=${() => setPreview(true)}>תצוגה מקדימה</button>
    </div>
    <div className="bra-panel">
      ${tab === "upload" && html`<${UploadForm} projectId=${projectId} L=${L} onCancel=${() => setTab("versions")} onDone=${(id) => { setOpenSet(id); setTab("versions"); }} />`}
      ${tab === "versions" && html`<${UploadTab} projectId=${projectId} projectName=${projectName} L=${L} openId=${openSet} onOpened=${() => setOpenSet(null)} />`}
      ${tab === "rooms" && html`<${RoomsTab} projectId=${projectId} projectName=${projectName} marks=${marks} brand=${brand} lliAll=${lliAll} onTickByRoom=${onTickByRoom} editsOk=${editsOk} onEdited=${loadEdits} L=${L} />`}
      ${tab === "qr" && html`<${QrLinks} projectId=${projectId} projectName=${projectName} L=${L} />`}
    </div>
    <div className="bra-foot bra-noprint"><button type="button" className="ghostBtn" disabled=${busy}
      onClick=${async () => { setBusy(true); await publishNow(projectId, projectName, marks, brand); setBusy(false); }}>${busy ? "מפרסם…" : "פרסום ללקוח"}</button></div>
    ${preview ? html`<div style=${{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,17,20,.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "16px 0" }}
        onClick=${(e) => e.target === e.currentTarget && setPreview(false)}>
      <div style=${{ display: "flex", alignItems: "center", gap: "12px", color: "#fff", fontSize: "12.5px", fontWeight: 700 }}>
        <span>תצוגה מקדימה — כך יראו הלקוח, האדריכל והפיקוח את הקישור</span>
        <button type="button" className="ghostBtn small" onClick=${() => setPreview(false)}>סגירה</button></div>
      <div className="bra-phone"><${ByRoomViewer} api=${api} /></div>
    </div>` : null}
  </div>`;
}

/** For a signed-in client or contractor inside the dashboard: the same viewer the QR opens, published data only. */
export function ByRoomMember({ projectId, projectName }) {
  const api = useMemo(() => tablesApi(projectId, projectName), [projectId, projectName]);
  return html`<div style=${{ height: "78vh", border: "1px solid #e6e6e9", borderRadius: "14px", overflow: "hidden" }}><${ByRoomViewer} api=${api} embedded=${true} /></div>`;
}

export default ByRoomAdmin;
