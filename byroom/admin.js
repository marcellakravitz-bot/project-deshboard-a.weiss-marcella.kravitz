// =============================================================================
//  byroom/admin.js — By Room for the system administrator. A. Weiss dashboard
//  byroom build 4 · 25.10.2026
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
export const BYROOM_BUILD = "byroom build 4 · 25.10.2026";

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
.bra input,.bra select{font:inherit;padding:6px 8px;border:1px solid #cfd3db;border-radius:8px;background:#fff}
.bra-cell{min-width:90px}.bra-cell .v{font-weight:600}.bra-cell .cur{color:#9a9da5;text-decoration:line-through;font-size:12px}
.bra-cell .alt{font-size:12px;color:#5b5e66}
.bra-scroll{max-height:68vh;overflow:auto;border:1px solid #e6e6e9;border-radius:10px}
.bra-src{font-size:12px;color:#5b5e66;margin:2px 0}
.bra-qrgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.bra-qr{border:1px solid #e6e6e9;border-radius:10px;padding:10px;text-align:center;background:#fff}
.bra-qr img{width:140px;height:140px}
.bra{width:100%}
.bra-panel{background:#fff;border:1px solid var(--line,#e6e6e9);border-radius:14px;padding:16px 18px;min-height:calc(var(--appvh, 760px) - 250px);width:100%;box-sizing:border-box}
.bra-panel table{table-layout:auto}
.bra-foot{display:flex;justify-content:center;margin:16px 0 4px}
.bra-foot .ghostBtn{background:#14181f;color:#fff;border-color:#14181f;padding:10px 22px;font-size:13.5px}
.bra-stamp{text-align:center;font-size:10.5px;color:#9a9da5;margin-top:6px}
.bra-phone{width:390px;max-width:94vw;height:min(800px,86vh);border-radius:34px;border:10px solid #101114;overflow:hidden;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,.35)}
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
.bra-mkrow{display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #f0f1f4}
.bra-mkrow img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e6e6e9}
.bra-mkrow .noimg{width:64px;height:64px;border-radius:8px;background:#f2f3f6}
.bra-tag{font-size:10px;font-weight:700;color:#1d5fa8;background:#e3eefb;border-radius:6px;padding:1px 5px;margin-inline-start:4px}
.bra-msgbox{white-space:pre-wrap;background:#f6f6f7;border:1px solid #e6e6e9;border-radius:10px;padding:12px;font-size:14px;line-height:1.55}
@media print{.bra-noprint{display:none!important}.bra-qrgrid{grid-template-columns:repeat(3,1fr)}.bra-qr{break-inside:avoid}}
`;

// ----------------------------------------------------------------------------- helpers
const fmtSize = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
const fmtDate = (s) => (s ? new Date(s).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "");
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
    ${msg && html`<div className="bra-warn">${msg}</div>`}
  </div>`;
}

function UploadTab({ projectId, projectName, L, openId, onOpened }) {
  const [sets, setSets] = useState(null);
  const [open, setOpen] = useState(openId ?? null);
  useEffect(() => { if (openId) { setOpen(openId); onOpened?.(); } }, [openId]);
  const load = async () => {
    const s = must(await supabase.from("byroom_plan_sets").select("*").eq("project_id", projectId).order("created_at", { ascending: false }));
    const ids = s.map((x) => x.id);
    const f = ids.length ? must(await supabase.from("byroom_plan_files").select("set_id, format").in("set_id", ids).neq("status", "removed")) : [];
    setSets(s.map((x) => ({ ...x, nfiles: f.filter((y) => y.set_id === x.id).length, formats: [...new Set(f.filter((y) => y.set_id === x.id).map((y) => y.format.toUpperCase()))].join(" · ") })));
  };
  useEffect(() => { load(); }, [projectId]);
  useInterval(load, 8000, !open && sets?.some((s) => ["uploading", "processing"].includes(s.status)));
  if (open) return html`<${SetScreen} setId=${open} projectName=${projectName} L=${L} onBack=${() => { setOpen(null); load(); }} />`;
  if (!sets) return html`<p>…</p>`;
  return html`<div>
    <h3 style=${{ marginTop: 0 }}>${L.versions}</h3>
    ${!sets.length ? html`<p>${L.noSets}</p>` : html`<table>
      <thead><tr><th>${L.name}</th><th>${L.floor}</th><th>${L.revision}</th><th>${L.date}</th><th>${L.remarks}</th><th>${L.files}</th><th>${L.status}</th><th>הועלה</th><th></th></tr></thead>
      <tbody>${sets.map((s) => html`<tr key=${s.id}>
        <td><b>${s.name}</b></td><td>${s.floor}</td><td>${s.revision ?? ""}</td><td>${fmtDay(s.revision_date)}</td>
        <td style=${{ maxWidth: "260px", whiteSpace: "pre-wrap", fontSize: "13px" }}>${s.remarks ?? ""}</td>
        <td>${s.nfiles}${s.formats ? html`<div style=${{ fontSize: "11px", color: "#5b5e66" }}>${s.formats}</div>` : null}</td>
        <td>${SET_ST[s.status] ?? s.status}</td>
        <td style=${{ fontSize: "12px" }}>${fmtDate(s.created_at)}${s.created_email ? html`<div>${s.created_email}</div>` : null}</td>
        <td><button className="bra-btn small" onClick=${() => setOpen(s.id)}>${s.status === "review" || s.status === "partly_approved" ? "בדיקה ואישור" : L.open}</button></td></tr>`)}</tbody></table>`}
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
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setSet(must(await supabase.from("byroom_plan_sets").select("*").eq("id", setId).single()));
    setFiles(must(await supabase.from("byroom_plan_files").select("*").eq("set_id", setId).neq("status", "removed").order("created_at")));
    setJobs(must(await supabase.from("byroom_parse_jobs").select("*").eq("set_id", setId).order("created_at", { ascending: false }).limit(30)));
  };
  useEffect(() => { load(); }, [setId]);
  const live = set && ["uploading", "processing"].includes(set.status) || files.some((f) => ["uploaded", "processing"].includes(f.status));
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
    ${files.length ? html`<table><thead><tr><th>קובץ</th><th>${L.type}</th><th>${L.floor}</th><th>${L.size}</th><th>${L.status}</th><th>זוהה בתוכן</th><th></th></tr></thead>
      <tbody>${files.map((f) => html`<tr key=${f.id}>
        <td>${f.original_name}${f.error ? html`<div className="bra-err">${f.error}</div>` : null}</td>
        <td>${TYPES[f.plan_type]}</td><td>${f.floor}</td><td>${fmtSize(f.size_bytes)}</td>
        <td>${FILE_ST[f.status]}${f.status === "uploading" ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>${L.resumeHint}</div>` : null}</td>
        <td style=${{ fontSize: "12px" }}>${f.detected?.content_hint ? `${TYPES[f.detected.content_hint] ?? f.detected.content_hint}${f.detected.content_hint !== f.plan_type && f.detected.content_hint !== "MODEL" ? " ⚠" : ""}` : ""}
          ${f.detected?.dates?.length ? html`<div>תאריכים: ${f.detected.dates.slice(0, 3).join(", ")}</div>` : null}</td>
        <td className="bra-row">
          ${f.format === "pdf" && f.archive_path ? html`<button className="bra-btn small" onClick=${async () => window.open((await fn({ action: "pdf_url", file_id: f.id })).url)}>${L.pdf}</button>` : null}
          ${["failed", "ready"].includes(f.status) ? html`<button className="bra-btn small" onClick=${async () => { await fn({ action: "reprocess", file_id: f.id }); load(); }}>${L.reprocess}</button>` : null}
          <button className="bra-btn small" onClick=${async () => { if (confirm(`להסיר את ${f.original_name} מהגרסה?`)) { await fn({ action: "remove_file", file_id: f.id }); load(); } }}>${L.remove}</button>
        </td></tr>`)}</tbody></table>` : html`<p>עדיין אין קבצים בגרסה הזו.</p>`}

    ${adding || files.some((f) => ["pending", "uploading", "failed"].includes(f.status)) ? html`
      <${DropZone} onFiles=${(l) => { setStaged((s) => [...s, ...stageRows(l, set.floor, files)]); setConfirmed(false); }} L=${L} />
      <${Staged} staged=${staged} setStaged=${setStaged} prog=${prog} busy=${busy} floor=${set.floor} L=${L} />
      ${ready && html`<div className="bra-row" style=${{ marginTop: "10px" }}>
        <label><input type="checkbox" checked=${confirmed} disabled=${busy} onChange=${(e) => setConfirmed(e.target.checked)} /> ${L.confirm}</label>
        <button className="bra-btn primary" disabled=${!confirmed || busy} onClick=${uploadMore}>${L.send}</button></div>`}`
      : html`<button className="bra-btn small" style=${{ marginTop: "8px" }} onClick=${() => setAdding(true)}>＋ הוספת קובץ לגרסה</button>`}
    ${msg && html`<div className="bra-warn">${msg}</div>`}

    ${note.warnings?.length ? html`<div className="bra-warn"><b>${L.warnings}</b><ul>${note.warnings.map((w, i) => html`<li key=${i}>${w}</li>`)}</ul></div>` : null}
    ${jobs.filter((j) => j.status === "failed").slice(0, 3).map((j) => html`<div className="bra-warn bra-err" key=${j.id}>${j.kind === "crosscheck" ? "הצלבה" : "עיבוד"} נכשל: ${j.error}</div>`)}
    ${files.some((f) => f.status === "ready") ? html`<div className="bra-row" style=${{ margin: "8px 0" }}>
      <button className="bra-btn small" onClick=${async () => { await fn({ action: "crosscheck", set_id: setId }); load(); }}>${L.crosscheck}</button></div>` : null}

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
      <button className="bra-btn small" onClick=${() => setTick(new Set())}>${L.clear}</button>
      <span style=${{ flex: 1 }} />
      <b>${tick.size} מסומנות</b>
      <button className="bra-btn primary" disabled=${!tick.size || busy} onClick=${approve}>${L.approveSel}</button>
    </div>
    <div className="bra-scroll"><table>
      <thead><tr><th>${L.room}</th>${FIELDS.map((f) => html`<th key=${f}>${FIELD_HE[f]}</th>`)}<th>${L.note}</th></tr></thead>
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

function MarkLine({ kind, code, lookup, manual, onRemove }) {
  const m = lookup(kind, code);
  return html`<div className="bra-mkrow">
    ${m?.image ? html`<img src=${m.image} alt="" />` : html`<div className="noimg" />`}
    <div style=${{ flex: 1 }}>
      <div><b dir="ltr">${code}</b>${m?.name && m.name !== code ? html` · ${m.name}` : null}${m?.fromLli ? html`<span className="bra-tag">LLI</span>` : null}${manual ? html`<span className="bra-tag" style=${{ color: "#8a3f07", background: "#f7efe3" }}>נוסף ידנית</span>` : null}</div>
      ${m?.desc ? html`<div style=${{ fontSize: "13px", color: "#3b3e45", whiteSpace: "pre-wrap" }}>${m.desc}</div>` : null}
      ${m?.supplier ? html`<div style=${{ fontSize: "12px", color: "#5b5e66" }}>ספק: ${m.supplier}</div>` : null}
      ${!m ? html`<div style=${{ fontSize: "12px", color: "#9a9da5" }}>אין עדיין פירוט לאיפיון הזה ב-LLI</div>` : null}
    </div>
    ${onRemove ? html`<button className="bra-btn small" title="הסרת האיפיון מהחדר" onClick=${onRemove}>הסרה</button>` : null}
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
  return html`<div className="bra-row" style=${{ marginTop: "10px", padding: "10px", background: "#fff", border: "1px dashed #cfd2d8", borderRadius: "10px" }}>
    <b style=${{ fontSize: "13px" }}>הוספת איפיון לחדר:</b>
    <input list="bra-marks" placeholder="קוד, למשל FL-7A" value=${code} onInput=${(e) => setCode(e.target.value)} style=${{ width: "150px" }} dir="ltr" />
    <datalist id="bra-marks">${catalog.map((m) => html`<option key=${m.code} value=${m.code}>${m.name ?? ""}</option>`)}</datalist>
    ${known ? html`<span style=${{ fontSize: "13px" }}>${catHe(known.kind)}${known.name && known.name !== known.code ? ` · ${known.name}` : ""}</span>`
      : html`<select value=${kind} onChange=${(e) => setKind(e.target.value)}>${kinds.map(([k, t]) => html`<option key=${k} value=${k}>${t}</option>`)}</select>`}
    <button className="bra-btn primary small" disabled=${!code.trim() || busy} onClick=${add}>הוספה</button>
    <span style=${{ fontSize: "12px", color: "#5b5e66" }}>נרשם ביומן, ומגיע ללקוח בפרסום הבא.</span>
  </div>`;
}

function RoomsTab({ projectId, projectName, marks, L }) {
  const [rooms, setRooms] = useState(null);
  const [pubAt, setPubAt] = useState(null);
  const [floor, setFloor] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [mapFloor, setMapFloor] = useState(null);
  const [map, setMap] = useState(null);
  const [tick, setTick] = useState(0);
  const lookup = useMemo(() => markIndex(marks), [marks]);
  const catalog = useMemo(() => markList(marks), [marks]);
  useEffect(() => { (async () => {
    const r = must(await supabase.from("byroom_rooms").select("id, floor, room_no, name, area, updated_at").eq("project_id", projectId).eq("status", "active"));
    const ids = r.map((x) => x.id);
    const f = [];
    for (let i = 0; i < ids.length; i += 300) f.push(...must(await supabase.from("byroom_room_finishes").select("room_id, kind, code, source").in("room_id", ids.slice(i, i + 300))));
    setPubAt(must(await supabase.from("byroom_projects").select("published_at").eq("project_id", projectId).limit(1)).at(0)?.published_at ?? null);
    setRooms(r.map((x) => ({ ...x, fin: f.filter((y) => y.room_id === x.id) })));
  })(); }, [projectId, tick]);
  useEffect(() => { if (!mapFloor) return; (async () => {
    setMap(must(await supabase.from("byroom_floor_maps").select("data").eq("project_id", projectId).eq("floor", mapFloor).eq("approved", true).order("created_at", { ascending: false }).limit(1)).at(0)?.data ?? null);
  })(); }, [mapFloor, projectId]);
  if (!rooms) return html`<p>…</p>`;
  if (!rooms.length) return html`<p>עדיין אין חדרים מאושרים. מעלים תוכניות ב"${L.upload}", ואחרי הבדיקה מאשרים ב-V.</p>`;
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const unpublished = (r) => !pubAt || new Date(r.updated_at) > new Date(pubAt);
  const qq = q.trim().toLowerCase();
  const list = rooms.filter((r) => (!floor || r.floor === floor) && (!qq || r.room_no.toLowerCase().includes(qq) || (r.name ?? "").toLowerCase().includes(qq)
    || r.fin.some((f) => f.code.toLowerCase().includes(qq) || (lookup(f.kind, f.code)?.name ?? "").toLowerCase().includes(qq)))).sort((a, b) => Number(a.floor) - Number(b.floor) || sortRooms(a, b));
  const codes = (r, k) => r.fin.filter((f) => f.kind === k).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const others = (r) => r.fin.filter((f) => !["FL", "FN", "CL"].includes(f.kind));
  const chip = (f) => { const m = lookup(f.kind, f.code); return html`<span className="bra-mk" key=${f.kind + f.code}><b dir="ltr">${f.code}${f.source === "manual" ? "*" : ""}</b>${m?.name && m.name !== f.code ? html`<span>${m.name}</span>` : null}</span>`; };
  const cell = (r, k) => html`<td>${codes(r, k).map(chip)}</td>`;
  const marksN = new Set(rooms.flatMap((r) => r.fin.map((f) => f.kind + "|" + f.code))).size;
  const remove = async (r, f) => {
    if (!confirm(`להסיר את ${f.code} מחדר ${r.room_no}?${f.source === "plan" ? "\nהאיפיון נקרא מהתוכניות — בגרסה הבאה הוא יוצע שוב לאישור." : ""}`)) return;
    try { must(await supabase.rpc("byroom_set_mark", { p_project: projectId, p_floor: r.floor, p_room: r.room_no, p_kind: f.kind, p_code: f.code, p_add: false })); setTick((t) => t + 1); }
    catch (e) { alert(e.message); }
  };
  if (mapFloor) {
    const sel = rooms.find((r) => r.floor === mapFloor && r.id === open);
    return html`<div>
      <div className="bra-row" style=${{ marginBottom: "8px" }}><button className="bra-btn" onClick=${() => { setMapFloor(null); setMap(null); }}>${L.back}</button>
        ${floors.length > 1 ? html`<select value=${mapFloor} onChange=${(e) => setMapFloor(e.target.value)}>${floors.map((f) => html`<option key=${f} value=${f}>${L.floor} ${f}</option>`)}</select>` : html`<b>${L.floor} ${mapFloor}</b>`}
        ${sel ? html`<span>${L.room} <b>${sel.room_no}</b> ${sel.name ?? ""}</span>` : html`<span style=${{ color: "#5b5e66" }}>לחיצה על חדר במפה פותחת אותו ברשימה</span>`}</div>
      <div className="brv" style=${{ height: "70vh", border: "1px solid #e6e6e9", borderRadius: "12px", overflow: "hidden" }}>
        <${FloorMap} map=${map} selected=${sel?.room_no ?? null} onPick=${(n) => { const r = rooms.find((x) => x.floor === mapFloor && x.room_no === n); if (r) { setOpen(r.id); setMapFloor(null); setFloor(r.floor); setQ(""); } }} /></div></div>`;
  }
  return html`<div>
    <div className="bra-row" style=${{ marginBottom: "10px" }}>
      <select value=${floor} onChange=${(e) => setFloor(e.target.value)}><option value="">כל הקומות</option>${floors.map((f) => html`<option key=${f} value=${f}>${L.floor} ${f}</option>`)}</select>
      <input type="search" placeholder="חיפוש חדר, שם או איפיון" value=${q} onInput=${(e) => setQ(e.target.value)} style=${{ minWidth: "220px" }} />
      <span style=${{ color: "#5b5e66" }}>${list.length} חדרים · ${marksN} איפיונים</span>
      <span style=${{ flex: 1 }} />
      <button className="bra-btn" onClick=${() => setMapFloor(floor || floors[0])}>מפת קומה</button>
    </div>
    <div className="bra-scroll"><table>
      <thead><tr><th>${L.floor}</th><th>${L.room}</th><th>שם החדר</th><th>${L.area}</th><th>${KIND.FL.he}</th><th>${KIND.FN.he}</th><th>${KIND.CL.he}</th><th>${FIELD_HE.other}</th></tr></thead>
      <tbody>${list.map((r) => html`<${React.Fragment} key=${r.id}>
        <tr style=${{ cursor: "pointer", background: open === r.id ? "var(--accent-soft,#eceef1)" : undefined }} onClick=${() => setOpen(open === r.id ? null : r.id)}>
          <td>${r.floor}</td><td><b dir="ltr">${r.room_no}</b> <span style=${{ fontSize: "11px", color: "#5b5e66" }}>${open === r.id ? "▲" : "▼"}</span>
</td>
          <td>${r.name ?? ""}</td><td>${r.area ? `${Number(r.area)} מ"ר` : ""}</td>
          ${cell(r, "FL")}${cell(r, "FN")}${cell(r, "CL")}<td>${others(r).map(chip)}</td></tr>
        ${open === r.id ? html`<tr><td colSpan="8" style=${{ background: "#fafafa" }}>
          ${[...new Set(r.fin.map((f) => f.kind))].sort(kindOrder).map((k) => html`<div key=${k} style=${{ marginBottom: "8px" }}>
            <div style=${{ fontWeight: 700, color: "var(--accent-ink,#000)", margin: "4px 0" }}>${catHe(k)}</div>
            ${codes(r, k).map((f) => html`<${MarkLine} key=${f.code} kind=${k} code=${f.code} lookup=${lookup} manual=${f.source === "manual"} onRemove=${() => remove(r, f)} />`)}</div>`)}
          ${!r.fin.length ? html`<p style=${{ color: "#9a9da5" }}>אין איפיונים לחדר הזה.</p>` : null}
          <${AddMark} projectId=${projectId} room=${r} catalog=${catalog} onDone=${() => setTick((t) => t + 1)} />
          <div style=${{ margin: "14px 0 4px", fontWeight: 700 }}>שינויים אחרונים (Recent Changes)</div>
          <${RecentChanges} projectId=${projectId} floor=${r.floor} room=${r.room_no} />
          <div style=${{ marginTop: "10px" }}><button className="bra-btn small" onClick=${() => setMapFloor(r.floor)}>הצגה על מפת הקומה</button></div>
        </td></tr>` : null}
      </${React.Fragment}>`)}</tbody></table></div>
    <p style=${{ fontSize: "12px", color: "#5b5e66" }}>השם, התיאור, התמונה והספק של כל איפיון נמשכים מה-LLI (שורות BY ROOM). * = נוסף ידנית.</p>
  </div>`;
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
export function ByRoomAdmin({ projectId, projectName, marks, categories, brand, isRTL = true }) {
  const L = W.he;
  CATS = categories || [];
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
      ${tab === "rooms" && html`<${RoomsTab} projectId=${projectId} projectName=${projectName} marks=${marks} L=${L} />`}
      ${tab === "qr" && html`<${QrLinks} projectId=${projectId} projectName=${projectName} L=${L} />`}
    </div>
    <div className="bra-foot bra-noprint"><button type="button" className="ghostBtn" disabled=${busy}
      onClick=${async () => { setBusy(true); await publishNow(projectId, projectName, marks, brand); setBusy(false); }}>${busy ? "מפרסם…" : "פרסום ללקוח"}</button></div>
    <div className="bra-stamp">${BYROOM_BUILD}</div>
    ${preview ? html`<div style=${{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,17,20,.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}
        onClick=${(e) => e.target === e.currentTarget && setPreview(false)}>
      <div style=${{ color: "#fff", fontSize: "13px", fontWeight: 700 }}>תצוגה מקדימה — כך יראו הלקוח, האדריכל והפיקוח את הקישור (כולל מה שאושר ועוד לא פורסם)</div>
      <div className="bra-phone"><${ByRoomViewer} api=${api} /></div>
      <button type="button" className="ghostBtn small" onClick=${() => setPreview(false)}>סגירה</button>
    </div>` : null}
  </div>`;
}

/** For a signed-in client or contractor inside the dashboard: the same viewer the QR opens, published data only. */
export function ByRoomMember({ projectId, projectName }) {
  const api = useMemo(() => tablesApi(projectId, projectName), [projectId, projectName]);
  return html`<div style=${{ height: "78vh", border: "1px solid #e6e6e9", borderRadius: "14px", overflow: "hidden" }}><${ByRoomViewer} api=${api} embedded=${true} /></div>`;
}

export default ByRoomAdmin;
