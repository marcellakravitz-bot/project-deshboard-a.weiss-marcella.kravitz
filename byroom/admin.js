// =============================================================================
//  byroom/admin.js — By Room for the system administrator. A. Weiss dashboard
//  byroom build 1 · 24.10.2026
//
//  The dashboard loads this file when the administrator opens the By Room cube.
//  It needs nothing from the dashboard except the project and the language:
//  it talks to Supabase through the shared client in ../sign.js and keeps all
//  of its data in the byroom_* tables. It never touches app_state.
//
//  Flow: new version -> drop all files -> confirm what was detected -> upload ->
//        processing (in the cloud) -> review per room -> tick V -> approve ticked.
//  Nothing reaches the approved data except byroom_approve_items(), for ticked rows.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";
import { supabase } from "../sign.js";
import { RoomViewer, KIND, viewCss } from "./view.js";

const html = htm.bind(React.createElement);
export const BYROOM_BUILD = "byroom build 1 · 24.10.2026";

// ----------------------------------------------------------------------------- words
const W = {
  he: {
    title: "By Room — ניהול", versions: "גרסאות תוכניות", rooms: "חדרים מאושרים", work: "קבצי עבודה", qr: "קישורים / QR", history: "היסטוריה",
    newVersion: "גרסה חדשה", floor: "קומה", name: "שם גרסה", revision: "Revision", date: "תאריך", create: "יצירה", cancel: "ביטול",
    open: "פתיחה", back: "חזרה", files: "קבצים", drop: "גררו לכאן את כל קבצי הקומה (PDF, DXF, RVT) — או לחצו לבחירה",
    detected: "זיהוי מוצע", type: "סוג תוכנית", format: "פורמט", size: "גודל", status: "סטטוס", remove: "הסרה",
    confirm: "אישרתי את הזיהוי", upload: "העלאה", uploading: "מעלה", processing: "בעיבוד", review: "לבדיקה",
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
  missing: { he: "חסר", c: "#5b6170", bg: "#eceef2" },
  single: { he: "מקור אחד", c: "#1d5fa8", bg: "#e3eefb" },
};
const CHANGE = { new: "חדש", changed: "שונה", removed: "נמחק", same: "ללא שינוי" };
const FILE_ST = { pending: "ממתין", uploading: "מעלה", uploaded: "הועלה", processing: "מעבד", ready: "מוכן", failed: "נכשל", removed: "הוסר" };
const SET_ST = { draft: "טיוטה", uploading: "בהעלאה", processing: "בעיבוד", review: "לבדיקה", partly_approved: "אושרה חלקית", approved: "אושרה", failed: "נכשלה", archived: "בארכיון" };
const TYPES = { FL: "ריצוף", FN: "חיפויים", CL: "תקרה", MODEL: "מודל Revit", OTHER: "אחר" };
const FIELDS = ["name", "boundary", "area", "FL", "FN", "CL"];
const FIELD_HE = { room: "חדר", name: "שם", boundary: "גבול", area: "שטח", FL: "ריצוף", FN: "חיפויים", CL: "תקרה" };

const css = `
.bra{font-family:system-ui,"Segoe UI",Arial,sans-serif;color:#1f2430;font-size:14px}
.bra h2{font-size:20px;margin:0 0 4px}.bra h3{font-size:16px;margin:16px 0 8px}
.bra-tabs{display:flex;gap:4px;border-bottom:1px solid #e1e4ea;margin:10px 0 14px;flex-wrap:wrap}
.bra-tab{padding:9px 14px;border:0;background:none;font:inherit;cursor:pointer;border-bottom:3px solid transparent;color:#5b6170}
.bra-tab.on{color:#9F1239;border-bottom-color:#9F1239;font-weight:600}
.bra-btn{font:inherit;padding:7px 13px;border-radius:8px;border:1px solid #cfd3db;background:#fff;cursor:pointer;color:#1f2430}
.bra-btn.primary{background:#9F1239;border-color:#9F1239;color:#fff}.bra-btn:disabled{opacity:.45;cursor:default}
.bra-btn.small{padding:4px 9px;font-size:13px}
.bra-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bra-card{background:#fff;border:1px solid #e1e4ea;border-radius:12px;padding:14px;margin-bottom:12px}
.bra table{border-collapse:collapse;width:100%;background:#fff}
.bra th,.bra td{border-bottom:1px solid #eceef2;padding:7px 8px;text-align:start;vertical-align:top}
.bra th{font-size:12px;color:#5b6170;font-weight:600;background:#f7f8fa;position:sticky;top:0;z-index:1}
.bra-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.bra-drop{border:2px dashed #c3c8d2;border-radius:12px;padding:26px;text-align:center;color:#5b6170;cursor:pointer;background:#fafbfc}
.bra-drop.over{border-color:#9F1239;background:#f6e8ec}
.bra-bar{height:6px;background:#eceef2;border-radius:3px;overflow:hidden;min-width:120px}
.bra-bar>i{display:block;height:100%;background:#9F1239}
.bra-warn{background:#fff6e0;border:1px solid #f1d38c;border-radius:10px;padding:10px 12px;margin:8px 0}
.bra-err{color:#b02a37}
.bra input,.bra select{font:inherit;padding:6px 8px;border:1px solid #cfd3db;border-radius:8px;background:#fff}
.bra-cell{min-width:90px}.bra-cell .v{font-weight:600}.bra-cell .cur{color:#8a8f9c;text-decoration:line-through;font-size:12px}
.bra-cell .alt{font-size:12px;color:#5b6170}
.bra-scroll{max-height:68vh;overflow:auto;border:1px solid #e1e4ea;border-radius:10px}
.bra-src{font-size:12px;color:#5b6170;margin:2px 0}
.bra-qrgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.bra-qr{border:1px solid #e1e4ea;border-radius:10px;padding:10px;text-align:center;background:#fff}
.bra-qr img{width:140px;height:140px}
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
function NewVersion({ projectId, onCreated, onCancel, L }) {
  const [v, setV] = useState({ floor: "", name: "", revision: "", revision_date: "" });
  const [err, setErr] = useState(null);
  const create = async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const row = must(await supabase.from("byroom_plan_sets").insert({
        project_id: projectId, floor: v.floor.trim(), name: v.name.trim(), revision: v.revision.trim() || null,
        revision_date: v.revision_date || null, created_email: u?.user?.email ?? null,
      }).select().single());
      onCreated(row);
    } catch (e) { setErr(e.message); }
  };
  return html`<div className="bra-card">
    <h3>${L.newVersion}</h3>
    <div className="bra-row">
      <label>${L.floor} <input style=${{ width: "70px" }} value=${v.floor} onInput=${(e) => setV({ ...v, floor: e.target.value })} /></label>
      <label>${L.name} <input placeholder="August 2026" value=${v.name} onInput=${(e) => setV({ ...v, name: e.target.value })} /></label>
      <label>${L.revision} <input style=${{ width: "90px" }} value=${v.revision} onInput=${(e) => setV({ ...v, revision: e.target.value })} /></label>
      <label>${L.date} <input type="date" value=${v.revision_date} onInput=${(e) => setV({ ...v, revision_date: e.target.value })} /></label>
      <button className="bra-btn primary" disabled=${!v.floor.trim() || !v.name.trim()} onClick=${create}>${L.create}</button>
      <button className="bra-btn" onClick=${onCancel}>${L.cancel}</button>
    </div>
    ${err && html`<p className="bra-err">${err}</p>`}
  </div>`;
}

function Versions({ projectId, onOpen, L }) {
  const [sets, setSets] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = async () => setSets(must(await supabase.from("byroom_plan_sets").select("*").eq("project_id", projectId).order("created_at", { ascending: false })));
  useEffect(() => { load(); }, [projectId]);
  if (!sets) return html`<p>…</p>`;
  return html`<div>
    <div className="bra-row" style=${{ marginBottom: "10px" }}><button className="bra-btn primary" onClick=${() => setAdding(true)}>${L.newVersion}</button></div>
    ${adding && html`<${NewVersion} projectId=${projectId} L=${L} onCancel=${() => setAdding(false)} onCreated=${(s) => { setAdding(false); onOpen(s.id); }} />`}
    ${!sets.length ? html`<p>${L.noSets}</p>` : html`<table>
      <thead><tr><th>${L.floor}</th><th>${L.name}</th><th>${L.revision}</th><th>${L.date}</th><th>${L.status}</th><th>נוצרה</th><th></th></tr></thead>
      <tbody>${sets.map((s) => html`<tr key=${s.id}>
        <td>${s.floor}</td><td>${s.name}</td><td>${s.revision ?? ""}</td><td>${s.revision_date ?? ""}</td><td>${SET_ST[s.status] ?? s.status}</td>
        <td>${fmtDate(s.created_at)} ${s.created_email ? "· " + s.created_email : ""}</td>
        <td><button className="bra-btn small" onClick=${() => onOpen(s.id)}>${L.open}</button></td></tr>`)}</tbody></table>`}
  </div>`;
}

// ----------------------------------------------------------------------------- one version: files + review
function SetScreen({ setId, projectName, onBack, L }) {
  const [set, setSet] = useState(null);
  const [files, setFiles] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [staged, setStaged] = useState([]);           // chosen on this screen, not yet uploaded
  const [confirmed, setConfirmed] = useState(false);
  const [prog, setProg] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [over, setOver] = useState(false);
  const inp = useRef(null);

  const load = async () => {
    setSet(must(await supabase.from("byroom_plan_sets").select("*").eq("id", setId).single()));
    setFiles(must(await supabase.from("byroom_plan_files").select("*").eq("set_id", setId).neq("status", "removed").order("created_at")));
    setJobs(must(await supabase.from("byroom_parse_jobs").select("*").eq("set_id", setId).order("created_at", { ascending: false }).limit(30)));
  };
  useEffect(() => { load(); }, [setId]);
  const live = set && ["uploading", "processing"].includes(set.status) || files.some((f) => ["uploaded", "processing"].includes(f.status));
  useInterval(load, 5000, live && !busy);

  const add = (list) => {
    const rows = [...list].map((file) => {
      const d = detectFile(file.name);
      const resume = files.find((f) => f.original_name === file.name && f.size_bytes === file.size && ["uploading", "pending", "failed"].includes(f.status));
      return { file, ...d, floor: d.floor ?? set.floor, type: d.type ?? "OTHER", resume: resume?.id ?? null,
               bad: !d.format ? "פורמט לא נתמך (PDF, DXF, RVT בלבד)" : null };
    });
    setStaged((s) => [...s, ...rows]);
    setConfirmed(false);
  };
  const upd = (i, k, v) => setStaged((s) => s.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const uploadAll = async () => {
    setBusy(true); setMsg(L.keepOpen);
    try {
      const { data: u } = await supabase.auth.getUser();
      // 1) fingerprint every file and register them all BEFORE any upload starts: the set is not cross-checked
      //    while a registered file is still pending, so a small PDF finishing first cannot close the set early
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
            set_id: setId, project_id: set.project_id, floor: r.floor, plan_type: r.type, format: r.format,
            original_name: r.file.name, size_bytes: r.file.size, sha256: sha, gzip_in_transit: r.format === "dxf", status: "pending",
            detected: { suggested: detectFile(r.file.name), chosen: { type: r.type, floor: r.floor }, by: u?.user?.email },
          }).select().single()).id;
        }
        work.push({ r, id, key, old: same ?? files.find((f) => f.id === id) });
      }
      // 2) upload them one by one
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
      setStaged([]); setMsg(L.canClose);
    } catch (e) { setMsg(null); alert(e.message); }
    setBusy(false); load();
  };

  if (!set) return html`<p>…</p>`;
  const note = (() => { try { return JSON.parse(set.note || "{}"); } catch (e) { return {}; } })();
  const reviewable = ["review", "partly_approved", "approved"].includes(set.status);
  return html`<div>
    <div className="bra-row" style=${{ justifyContent: "space-between" }}>
      <div><h2>${projectName} · ${L.floor} ${set.floor} · ${set.name}</h2>
        <div style=${{ color: "#5b6170" }}>${set.revision ? `Revision ${set.revision} · ` : ""}${set.revision_date ?? ""} · ${SET_ST[set.status]}</div></div>
      <button className="bra-btn" onClick=${onBack}>${L.back}</button>
    </div>

    <h3>${L.files}</h3>
    ${files.length ? html`<table><thead><tr><th>קובץ</th><th>${L.type}</th><th>${L.floor}</th><th>${L.size}</th><th>${L.status}</th><th>זוהה בתוכן</th><th></th></tr></thead>
      <tbody>${files.map((f) => html`<tr key=${f.id}>
        <td>${f.original_name}${f.error ? html`<div className="bra-err">${f.error}</div>` : null}</td>
        <td>${TYPES[f.plan_type]}</td><td>${f.floor}</td><td>${fmtSize(f.size_bytes)}</td>
        <td>${FILE_ST[f.status]}${f.status === "uploading" ? html`<div style=${{ fontSize: "12px", color: "#5b6170" }}>${L.resumeHint}</div>` : null}</td>
        <td style=${{ fontSize: "12px" }}>${f.detected?.content_hint ? `${TYPES[f.detected.content_hint] ?? f.detected.content_hint}${f.detected.content_hint !== f.plan_type && f.detected.content_hint !== "MODEL" ? " ⚠" : ""}` : ""}
          ${f.detected?.dates?.length ? html`<div>תאריכים: ${f.detected.dates.slice(0, 3).join(", ")}</div>` : null}</td>
        <td className="bra-row">
          ${f.format === "pdf" && f.archive_path ? html`<button className="bra-btn small" onClick=${async () => window.open((await fn({ action: "pdf_url", file_id: f.id })).url)}>${L.pdf}</button>` : null}
          ${["failed", "ready"].includes(f.status) ? html`<button className="bra-btn small" onClick=${async () => { await fn({ action: "reprocess", file_id: f.id }); load(); }}>${L.reprocess}</button>` : null}
          <button className="bra-btn small" onClick=${async () => { if (confirm(`להסיר את ${f.original_name} מהגרסה?`)) { await fn({ action: "remove_file", file_id: f.id }); load(); } }}>${L.remove}</button>
        </td></tr>`)}</tbody></table>` : null}

    <div className=${`bra-drop ${over ? "over" : ""}`} style=${{ marginTop: "12px" }}
      onClick=${() => inp.current?.click()} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
      ${L.drop}
      <input ref=${inp} type="file" multiple accept=".pdf,.dxf,.rvt" style=${{ display: "none" }} onChange=${(e) => { add(e.target.files); e.target.value = ""; }} />
    </div>

    ${staged.length ? html`<div className="bra-card" style=${{ marginTop: "12px" }}>
      <h3>${L.detected}</h3>
      <table><thead><tr><th>קובץ</th><th>${L.format}</th><th>${L.type}</th><th>${L.floor}</th><th>${L.size}</th><th>למה</th><th></th></tr></thead>
        <tbody>${staged.map((r, i) => r.removed ? null : html`<tr key=${i}>
          <td>${r.file.name}${r.bad ? html`<div className="bra-err">${r.bad}</div>` : null}${r.resume ? html`<div style=${{ fontSize: "12px" }}>ימשיך העלאה שנקטעה</div>` : null}
            ${prog[r.file.name] ? html`<div>${prog[r.file.name].phase}<div className="bra-bar"><i style=${{ width: `${Math.round(prog[r.file.name].v * 100)}%` }} /></div></div>` : null}</td>
          <td>${r.format?.toUpperCase() ?? "?"}</td>
          <td><select disabled=${busy || r.format === "rvt"} value=${r.type} onChange=${(e) => upd(i, "type", e.target.value)}>
            ${Object.entries(TYPES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></td>
          <td><input style=${{ width: "56px" }} disabled=${busy} value=${r.floor} onInput=${(e) => upd(i, "floor", e.target.value)} />
            ${r.floor !== set.floor ? html`<div className="bra-err" style=${{ fontSize: "12px" }}>${L.wrongFloor}</div>` : null}</td>
          <td>${fmtSize(r.file.size)}</td><td style=${{ fontSize: "12px" }}>${r.why}</td>
          <td><button className="bra-btn small" disabled=${busy} onClick=${() => upd(i, "removed", true)}>${L.remove}</button></td></tr>`)}</tbody></table>
      <div className="bra-row" style=${{ marginTop: "10px" }}>
        <label><input type="checkbox" checked=${confirmed} disabled=${busy} onChange=${(e) => setConfirmed(e.target.checked)} /> ${L.confirm}</label>
        <button className="bra-btn primary" disabled=${!confirmed || busy || !staged.some((r) => !r.bad && !r.removed)} onClick=${uploadAll}>${L.upload}</button>
      </div>
    </div>` : null}
    ${msg && html`<div className="bra-warn">${msg}</div>`}

    ${note.warnings?.length ? html`<div className="bra-warn"><b>${L.warnings}</b><ul>${note.warnings.map((w, i) => html`<li key=${i}>${w}</li>`)}</ul></div>` : null}
    ${jobs.filter((j) => j.status === "failed").slice(0, 3).map((j) => html`<div className="bra-warn bra-err" key=${j.id}>${j.kind === "crosscheck" ? "הצלבה" : "עיבוד"} נכשל: ${j.error}</div>`)}
    ${files.some((f) => f.status === "ready") ? html`<div className="bra-row" style=${{ margin: "8px 0" }}>
      <button className="bra-btn small" onClick=${async () => { await fn({ action: "crosscheck", set_id: setId }); load(); }}>${L.crosscheck}</button></div>` : null}

    ${reviewable ? html`<${Review} set=${set} files=${files} L=${L} onApproved=${load} />` : null}
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
    const p = it.proposed || {}, c = it.current || {};
    const val = ["FL", "FN", "CL"].includes(it.field) ? (p.codes || []).join(", ") || "—"
      : it.field === "boundary" ? (p.poly ? `נסגר${p.geom_area ? ` · ${p.geom_area} מ"ר` : ""}` : "לא נסגר")
      : it.field === "room" ? (it.change_type === "removed" ? "נמחק" : "קיים") : (p.value ?? "—");
    const cur = it.change_type === "changed" ? (["FL", "FN", "CL"].includes(it.field) ? (c.codes || []).join(", ") : it.field === "boundary" ? "גבול קודם" : c.value) : null;
    return html`<td className="bra-cell" style=${{ background: STATUS[it.status]?.bg }}>
      <div className="bra-row" style=${{ gap: "6px", flexWrap: "nowrap" }}>
        ${it.decision === "pending" ? html`<input type="checkbox" title="V" checked=${tick.has(it.id)} onChange=${() => toggle(it.id)} />` : html`<span title=${it.decision === "approved" ? "אושר" : L.unchanged}>${it.decision === "approved" ? "✓" : "="}</span>`}
        <span className="v">${String(val)}</span>${it.rvt_verified ? html`<span title="אומת גם במודל Revit" style=${{ fontSize: "11px" }}> ·RVT</span>` : null}
      </div>
      ${cur != null ? html`<div className="cur">${String(cur)}</div>` : null}
      <div className="alt">${pill(it.status)} ${it.change_type !== "same" ? CHANGE[it.change_type] : ""}</div>
      ${it.status === "conflict" && it.proposed?.alternatives && it.decision === "pending" ? html`<div className="alt">
        ${Object.entries(it.proposed.alternatives).filter(([, v]) => v?.length).map(([k, v]) => html`<button key=${k} className="bra-btn small" style=${{ marginTop: "3px", fontWeight: it.proposed.chosen === k ? 700 : 400 }} onClick=${() => chooseAlt(it, k)}>${k}: ${v.join(", ")}</button>`)}</div>` : null}
    </td>`;
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
            ${FIELDS.map((k) => html`<${React.Fragment} key=${k}>${cell(f[k])}</${React.Fragment}>`)}
            <td style=${{ fontSize: "12px", maxWidth: "260px" }}>${notes.join(" · ")}</td>
          </tr>
          ${open === r ? html`<tr><td colSpan=${FIELDS.length + 2} style=${{ background: "#fafbfc" }}>
            ${Object.values(f).map((it) => html`<div key=${it.id} style=${{ marginBottom: "6px" }}><b>${FIELD_HE[it.field]}</b>
              ${(it.sources || []).map((s, i) => html`<div className="bra-src" key=${i}>${s.src} · ${s.file}${s.value != null ? ` · ${s.value}` : ""} — ${s.how}${s.confidence ? ` (${STATUS[s.confidence]?.he ?? s.confidence})` : ""}</div>`)}</div>`)}
          </td></tr>` : null}
        </${React.Fragment}>`;
      })}</tbody></table></div>
  </div>`;
}

// ----------------------------------------------------------------------------- approved rooms (viewer)
function ApprovedRooms({ projectId, projectName }) {
  const [floors, setFloors] = useState(null);
  useEffect(() => { (async () => {
    const rows = must(await supabase.from("byroom_floor_maps").select("floor").eq("project_id", projectId).eq("approved", true));
    setFloors([...new Set(rows.map((r) => r.floor))].sort((a, b) => Number(a) - Number(b)));
  })(); }, [projectId]);
  if (!floors) return html`<p>…</p>`;
  if (!floors.length) return html`<p>עדיין אין חדרים מאושרים.</p>`;
  return html`<div style=${{ height: "75vh", border: "1px solid #e1e4ea", borderRadius: "12px", overflow: "hidden" }}>
    <${RoomViewer} title=${projectName} floors=${floors} lang="he" load=${(f, r) => loadFromTables(projectId, f, r)} /></div>`;
}

/** The same answer byroom-public gives, read through the signed-in user's own permissions. */
export async function loadFromTables(projectId, floor, room) {
  const map = must(await supabase.from("byroom_floor_maps").select("data").eq("project_id", projectId).eq("floor", floor).eq("approved", true)
    .order("created_at", { ascending: false }).limit(1)).at(0)?.data ?? null;
  const rooms = must(await supabase.from("byroom_rooms").select("id, room_no, name, area").eq("project_id", projectId).eq("floor", floor).eq("status", "active"));
  const out = { map, rooms: rooms.map((r) => ({ n: r.room_no, name: r.name })), room: null };
  const r = room && rooms.find((x) => x.room_no.toLowerCase() === String(room).toLowerCase());
  if (r) out.room = { n: r.room_no, name: r.name, area: r.area, finishes: must(await supabase.from("byroom_room_finishes").select("kind, code").eq("room_id", r.id)) };
  return out;
}

// ----------------------------------------------------------------------------- work files
function WorkFiles({ projectId, L }) {
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(new Set());
  const load = async () => setRows(must(await supabase.from("byroom_plan_files").select("*, byroom_plan_sets(name, floor)")
    .eq("project_id", projectId).in("format", ["dxf", "rvt"]).neq("status", "removed").order("created_at", { ascending: false })));
  useEffect(() => { load(); }, [projectId]);
  if (!rows) return html`<p>…</p>`;
  const now = Date.now();
  const due = rows.filter((r) => !r.purged_at && !r.keep && r.purge_after && new Date(r.purge_after) <= now);
  const purge = async (ids) => {
    if (!ids.length || !confirm(`למחוק ${ids.length} קבצי עבודה? הנתונים המפוענחים וה-PDF נשמרים. אי אפשר לבטל.`)) return;
    try { await fn({ action: "purge", file_ids: ids }); setSel(new Set()); load(); } catch (e) { alert(e.message); }
  };
  return html`<div>
    <p>${L.neverPdf}</p>
    <div className="bra-row" style=${{ marginBottom: "8px" }}>
      <button className="bra-btn" disabled=${!due.length} onClick=${() => purge(due.map((r) => r.id))}>${L.purgeDue} (${due.length})</button>
      <button className="bra-btn" disabled=${!sel.size} onClick=${() => purge([...sel])}>${L.purgeNow} (${sel.size})</button>
    </div>
    <table><thead><tr><th></th><th>קובץ</th><th>גרסה</th><th>${L.size}</th><th>${L.due}</th><th>${L.keep}</th><th>${L.status}</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.id}>
        <td>${r.purged_at ? null : html`<input type="checkbox" disabled=${r.keep} checked=${sel.has(r.id)} onChange=${() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />`}</td>
        <td>${r.original_name}</td><td>${L.floor} ${r.byroom_plan_sets?.floor} · ${r.byroom_plan_sets?.name}</td><td>${fmtSize(r.size_bytes)}</td>
        <td>${r.purged_at ? `${L.purged} ${fmtDate(r.purged_at)}` : r.keep ? "—" : r.purge_after ? fmtDate(r.purge_after) : "אחרי אישור הגרסה + 30 יום"}</td>
        <td><input type="checkbox" disabled=${!!r.purged_at} checked=${r.keep} onChange=${async (e) => { must(await supabase.from("byroom_plan_files").update({ keep: e.target.checked }).eq("id", r.id)); load(); }} /></td>
        <td>${FILE_ST[r.status]}</td></tr>`)}</tbody></table>
  </div>`;
}

// ----------------------------------------------------------------------------- QR
function QrLinks({ projectId, projectName, L }) {
  const [key, setKey] = useState(undefined);
  const [floors, setFloors] = useState([]);
  const [floor, setFloor] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [imgs, setImgs] = useState({});
  const base = new URL("./", import.meta.url).href;
  const load = async () => {
    setKey(must(await supabase.from("byroom_room_links").select("*").eq("project_id", projectId).is("revoked_at", null).order("created_at", { ascending: false }).limit(1)).at(0) ?? null);
    const fl = [...new Set(must(await supabase.from("byroom_rooms").select("floor").eq("project_id", projectId).eq("status", "active")).map((r) => r.floor))].sort((a, b) => Number(a) - Number(b));
    setFloors(fl); setFloor((f) => f ?? fl[0] ?? null);
  };
  useEffect(() => { load(); }, [projectId]);
  useEffect(() => { if (!floor) return; (async () => {
    setRooms(must(await supabase.from("byroom_rooms").select("room_no, name").eq("project_id", projectId).eq("floor", floor).eq("status", "active").order("room_no")));
  })(); }, [floor, projectId]);
  const url = (r) => `${base}?${new URLSearchParams({ k: key.token, f: floor, ...(r ? { r } : {}) })}`;
  useEffect(() => { if (!key || !rooms.length) return; (async () => {
    const QR = (await import("https://esm.sh/qrcode@1.5.4")).default;
    const out = {};
    for (const r of rooms) out[r.room_no] = await QR.toDataURL(url(r.room_no), { margin: 1, width: 280 });
    out["*"] = await QR.toDataURL(url(null), { margin: 1, width: 280 });
    setImgs(out);
  })(); }, [key, rooms]);
  const make = async () => { must(await supabase.from("byroom_room_links").insert({ project_id: projectId, project_name: projectName })); load(); };
  const revoke = async () => { if (confirm("לבטל את המפתח? כל קודי ה-QR שהודפסו יפסיקו לעבוד.")) { must(await supabase.from("byroom_room_links").update({ revoked_at: new Date().toISOString() }).eq("id", key.id)); load(); } };
  if (key === undefined) return html`<p>…</p>`;
  return html`<div>
    <div className="bra-row bra-noprint" style=${{ marginBottom: "10px" }}>
      ${key ? html`<span>${L.key}: נוצר ${fmtDate(key.created_at)}</span><button className="bra-btn small" onClick=${revoke}>${L.revoke}</button>`
            : html`<span>${L.noKey}</span><button className="bra-btn primary" onClick=${make}>${L.makeKey}</button>`}
      ${floors.length ? html`<select value=${floor ?? ""} onChange=${(e) => setFloor(e.target.value)}>${floors.map((f) => html`<option key=${f} value=${f}>${L.floor} ${f}</option>`)}</select>` : null}
      ${key && rooms.length ? html`<button className="bra-btn" onClick=${() => window.print()}>${L.print}</button>` : null}
    </div>
    ${key && floor ? html`<div className="bra-qrgrid">
      <div className="bra-qr"><img src=${imgs["*"]} alt="" /><div><b>${L.floor} ${floor}</b></div><div>כל הקומה</div>
        <button className="bra-btn small bra-noprint" onClick=${() => navigator.clipboard.writeText(url(null))}>${L.copy}</button></div>
      ${rooms.map((r) => html`<div className="bra-qr" key=${r.room_no}><img src=${imgs[r.room_no]} alt="" />
        <div><b>${L.room} ${r.room_no}</b></div><div style=${{ fontSize: "12px" }}>${r.name ?? ""}</div><div style=${{ fontSize: "11px", color: "#5b6170" }}>${projectName} · ${L.floor} ${floor}</div>
        <button className="bra-btn small bra-noprint" onClick=${() => navigator.clipboard.writeText(url(r.room_no))}>${L.copy}</button></div>`)}
    </div>` : null}
  </div>`;
}

// ----------------------------------------------------------------------------- history
function History({ projectId, L }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { (async () => {
    const sets = must(await supabase.from("byroom_plan_sets").select("id, name, floor").eq("project_id", projectId));
    const ids = sets.map((s) => s.id);
    const ap = ids.length ? must(await supabase.from("byroom_room_approvals").select("*").in("set_id", ids).order("approved_at", { ascending: false })) : [];
    setRows(ap.map((a) => ({ ...a, set: sets.find((s) => s.id === a.set_id) })));
  })(); }, [projectId]);
  if (!rows) return html`<p>…</p>`;
  if (!rows.length) return html`<p>עדיין לא אושרו שינויים בפרויקט הזה.</p>`;
  return html`<table><thead><tr><th>מתי</th><th>${L.approvedBy}</th><th>גרסה</th><th>${L.items}</th><th>${L.leftPending}</th><th></th></tr></thead>
    <tbody>${rows.map((a) => html`<${React.Fragment} key=${a.id}><tr>
      <td>${fmtDate(a.approved_at)}</td><td>${a.approved_email ?? ""}</td><td>${L.floor} ${a.set?.floor} · ${a.set?.name}</td>
      <td>${a.items.length}</td><td>${a.left_pending}</td>
      <td><button className="bra-btn small" onClick=${() => setOpen(open === a.id ? null : a.id)}>${open === a.id ? "▲" : "▼"}</button></td></tr>
      ${open === a.id ? html`<tr><td colSpan="6" style=${{ background: "#fafbfc", fontSize: "12px" }}>${a.items.map((i, k) => html`<div key=${k}>
        ${L.room} ${i.room} · ${FIELD_HE[i.field]}: ${JSON.stringify(i.after?.codes ?? i.after?.value ?? (i.after?.poly ? "גבול" : i.after))}</div>`)}</td></tr>` : null}
    </${React.Fragment}>`)}</tbody></table>`;
}

// ============================================================================= the screen
export function ByRoomAdmin({ projectId, projectName, isRTL = true }) {
  const L = W.he;
  const [tab, setTab] = useState("versions");
  const [setId, setSetId] = useState(null);
  const tabs = [["versions", L.versions], ["rooms", L.rooms], ["work", L.work], ["qr", L.qr], ["history", L.history]];
  return html`<div className="bra" dir="rtl">
    <style>${css}${viewCss}</style>
    <div className="bra-row" style=${{ justifyContent: "space-between" }}><h2>${L.title} · ${projectName}</h2><span style=${{ fontSize: "11px", color: "#8a8f9c" }}>${BYROOM_BUILD}</span></div>
    <div className="bra-tabs bra-noprint">${tabs.map(([k, t]) => html`<button key=${k} className=${`bra-tab ${tab === k ? "on" : ""}`} onClick=${() => { setTab(k); setSetId(null); }}>${t}</button>`)}</div>
    ${tab === "versions" && (setId ? html`<${SetScreen} setId=${setId} projectName=${projectName} L=${L} onBack=${() => setSetId(null)} />`
                                    : html`<${Versions} projectId=${projectId} L=${L} onOpen=${setSetId} />`)}
    ${tab === "rooms" && html`<${ApprovedRooms} projectId=${projectId} projectName=${projectName} />`}
    ${tab === "work" && html`<${WorkFiles} projectId=${projectId} L=${L} />`}
    ${tab === "qr" && html`<${QrLinks} projectId=${projectId} projectName=${projectName} L=${L} />`}
    ${tab === "history" && html`<${History} projectId=${projectId} L=${L} />`}
  </div>`;
}

/** For a signed-in client or contractor inside the dashboard: the same viewer, approved data only. */
export function ByRoomMember({ projectId, projectName }) {
  return html`<${ApprovedRooms} projectId=${projectId} projectName=${projectName} />`;
}

export default ByRoomAdmin;
