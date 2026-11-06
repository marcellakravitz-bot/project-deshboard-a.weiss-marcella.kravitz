// ---------------------------------------------------------------------------
// sub-portal — the only server the subcontractor app talks to.
//
// Why it exists: the personal code has to be checked somewhere the contractor
// cannot read. Anything the browser can do, the browser can be made to show —
// so the check, and every read that follows it, happens here with the service
// role, and the app receives only what that contractor is allowed to see.
//
// It stores nothing of its own. The register of subcontractors already lives
// in the project row the dashboard writes (subsData), so there is one list to
// keep, not two.
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUBS_SERVICE_KEY") || "";
const TOKEN_SECRET = Deno.env.get("SUBS_TOKEN_SECRET")!;
const BUCKET = "submittals";
const clean = (v: string | undefined) => String(v || "").trim().replace(/\s+/g, "");
const VAPID_PUBLIC = clean(Deno.env.get("VAPID_PUBLIC"));
const VAPID_PRIVATE = clean(Deno.env.get("VAPID_PRIVATE"));
const rawSubject = String(Deno.env.get("VAPID_SUBJECT") || "").trim();
const VAPID_SUBJECT = /^(mailto:|https:)/.test(rawSubject)
  ? rawSubject
  : (rawSubject.includes("@") ? "mailto:" + rawSubject : "mailto:info@aweiss.co.il");

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function normPhone(raw: string): string {
  let d = String(raw || "").replace(/\D+/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  return d;
}
const normCode = (raw: string) => String(raw || "").trim().toUpperCase();

async function pinHash(phone: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${phone}:${pin}:${TOKEN_SECRET}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
}
async function makeToken(phone: string): Promise<string> {
  const body = btoa(JSON.stringify({ p: phone, t: Date.now() })).replace(/=+$/, "");
  return body + "." + await hmac(body);
}
async function readToken(token: string): Promise<string | null> {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  if (await hmac(body) !== sig) return null;
  try { return JSON.parse(atob(body)).p || null; } catch { return null; }
}

function parse(v: any) {
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
  return v || {};
}
async function loadMeta(): Promise<Record<string, any>> {
  const { data } = await db.from("app_state").select("value").eq("key", "system-state").maybeSingle();
  const state = parse(data?.value);
  const out: Record<string, any> = {};
  const contractors = Array.isArray(state) ? state : (state?.contractors || []);
  for (const c of contractors || []) {
    for (const p of (c?.projects || [])) {
      if (!p || !p.id) continue;
      const from = p.floorsFrom, to = p.floorsTo;
      out[p.id] = {
        name: p.name || "",
        logo: p.clientLogoUrl || "",
        floors: from || to ? `Floors ${from || ""}${from && to ? "-" : ""}${to || ""}` : "",
        dates: p.startDate || p.endDate ? `${fmtDate(p.startDate)} - ${fmtDate(p.endDate)}` : "",
      };
    }
  }
  return out;
}
function fmtDate(v: any) {
  if (!v) return "";
  const s = String(v).slice(0, 10);
  const p = s.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}
async function loadPart(prefix: string): Promise<Record<string, any>> {
  const { data } = await db.from("app_state").select("key, value").like("key", prefix + ":%");
  const out: Record<string, any> = {};
  for (const row of (data || [])) out[String(row.key).slice(prefix.length + 1)] = parse(row.value);
  return out;
}
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const str = atob(pad + "=".repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}
function bytesToB64url(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function vapidHeader(endpoint: string): Promise<string | null> {
  if (!VAPID_PRIVATE || !VAPID_PUBLIC) return null;
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT,
  })));
  const signing = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256",
      d: VAPID_PRIVATE,
      x: bytesToB64url(b64urlToBytes(VAPID_PUBLIC).slice(1, 33)),
      y: bytesToB64url(b64urlToBytes(VAPID_PUBLIC).slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signing));
  return `vapid t=${signing}.${bytesToB64url(new Uint8Array(sig))},k=${VAPID_PUBLIC}`;
}
async function notifyPhones(phones: string[], projectId: string, exclude?: string) {
  const report: any = { devices: 0, results: [] as string[] };
  const list = Array.from(new Set(phones.filter(Boolean))).filter((p) => p !== exclude);
  if (!list.length) { report.note = "no phones"; return report; }
  const { data } = await db.from("subs_push").select("endpoint, phone").in("phone", list);
  report.devices = (data || []).length;
  if (!VAPID_PRIVATE || !VAPID_PUBLIC) { report.note = "no vapid keys"; return report; }
  for (const row of (data || [])) {
    try {
      const auth = await vapidHeader(row.endpoint);
      if (!auth) { report.results.push("no auth header"); continue; }
      const res = await fetch(row.endpoint, {
        method: "POST",
        headers: { Authorization: auth, TTL: "86400", "Content-Length": "0", Urgency: "high" },
      });
      let body = "";
      try { body = (await res.text()).slice(0, 200); } catch (e) {}
      report.results.push(`${new URL(row.endpoint).host} ${res.status} ${body}`.trim());
      if (res.status === 404 || res.status === 410) {
        await db.from("subs_push").delete().eq("endpoint", row.endpoint);
      }
    } catch (e) {
      report.results.push("threw: " + String((e as any)?.message || e));
    }
  }
  return report;
}
async function phonesFor(projectId: string, trade: string): Promise<string[]> {
  const projects = await loadProjects();
  const p = projects.filter((x: any) => x.id === projectId)[0];
  const list = ((p?.extras?.subsData || {}).list) || [];
  return list
    .filter((s: any) => s && s.active !== false && (s.pm || !trade || s.trade === trade))
    .map((s: any) => normPhone(s.phone));
}

async function editSubsRow(projectId: string, change: (cur: any) => any) {
  const key = `project-subs:${projectId}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row } = await db.from("app_state").select("value, version").eq("key", key).maybeSingle();
    const cur = parse(row?.value);
    const next = change(JSON.parse(JSON.stringify(cur || {})));
    if (!row) {
      const { error } = await db.from("app_state").insert({ key, value: next, version: 1 });
      if (!error) return next;
      continue;
    }
    const version = Number(row.version || 1);
    const { data: done } = await db.from("app_state")
      .update({ value: next, version: version + 1 })
      .eq("key", key).eq("version", version).select("key");
    if (done && done.length) return next;
  }
  throw new Error("busy");
}

async function loadProjects() {
  const { data, error } = await db.from("app_state").select("key, value").like("key", "project-extras%");
  if (error) throw error;
  const out: any[] = [];
  for (const row of (data || [])) {
    const key = String(row.key);
    if (key === "project-extras") {
      const all = parse(row.value);
      for (const [id, extras] of Object.entries<any>(all || {})) {
        if (extras && typeof extras === "object") out.push({ id, extras });
      }
    } else if (key.startsWith("project-extras:")) {
      out.push({ id: key.slice("project-extras:".length), extras: parse(row.value), own: true });
    }
  }
  const { data: subRows } = await db.from("app_state").select("key, value").like("key", "project-subs:%");
  const subsById: Record<string, any> = {};
  for (const row of (subRows || [])) subsById[String(row.key).slice("project-subs:".length)] = parse(row.value);
  for (const p of out) {
    if (subsById[p.id]) p.extras = { ...p.extras, subsData: subsById[p.id] };
  }
  const byId = new Map<string, any>();
  for (const p of out) {
    const prev = byId.get(p.id);
    if (!prev) { byId.set(p.id, p); continue; }
    if (p.own && !prev.own) byId.set(p.id, { ...p, extras: { ...prev.extras, ...p.extras } });
    else byId.set(p.id, { ...prev, extras: { ...p.extras, ...prev.extras } });
  }
  return Array.from(byId.values());
}
function grantsFor(projects: any[], phone: string, code: string | null) {
  const out: any[] = [];
  for (const p of projects) {
    const list = ((p.extras.subsData || {}).list) || [];
    for (const s of list) {
      if (s.active === false) continue;
      if (normPhone(s.phone) !== phone) continue;
      if (code !== null && normCode(s.code) !== code) continue;
      out.push({
        projectId: p.id,
        trade: s.trade,
        name: s.name || "",
        company: s.company || "",
        canWrite: !!s.pm,
        isPm: !!s.pm,
        extras: p.extras,
      });
    }
  }
  const merged = new Map<string, any>();
  for (const g of out) {
    const prev = merged.get(g.projectId);
    if (!prev) { merged.set(g.projectId, g); continue; }
    merged.set(g.projectId, {
      ...prev,
      isPm: prev.isPm || g.isPm,
      canWrite: prev.canWrite || g.canWrite,
      name: prev.name || g.name,
      company: prev.company || g.company,
      trade: prev.trade || g.trade,
    });
  }
  return Array.from(merged.values());
}
async function signed(path: string) {
  if (!path) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}
async function signAll(atts: any[]) {
  const out: any[] = [];
  for (const a of atts || []) {
    if (!a || !a.path) continue;
    out.push({ name: a.name || "", type: a.type || "", url: await signed(a.path) });
  }
  return out;
}

const TRADE_CATS: Record<string, string[]> = {
  hvac: ["hvac"],
  electric: ["electrical", "lighting", "security"],
  plumbing: ["plumbing"],
  security: ["security"],
  drywall: [],
  paint: [],
};
const APPROVED = ["approved", "approvedNoted"];

async function boardFor(grant: any) {
  const ex = grant.extras || {};
  const trade = grant.trade;

  // 21.10.26 — a submittal goes to the trades ticked on it (ניהול קבלן),
  // exactly as an SD row does. One never ticked falls back to the folders the
  // trade has always seen. The "show" tick is gone from the dashboard.
  const cats = TRADE_CATS[trade] || [];
  const ticked = (r: any) => Array.isArray(r.subs) ? r.subs.indexOf(trade) >= 0 : cats.indexOf(r.category) >= 0;
  const allSent = (ex.submittals || []).filter((r: any) => r && r.sent);
  const records = allSent.filter(ticked);
  const off = ex.submittalChkOff || {};
  const sbAp = ex.submittalApprovals || {};
  const decisionOfRec = (r: any) =>
    ((sbAp[r?.id] || {}).review || {}).decision || ((r?.reviews || [])[0] || {}).decision || null;
  const submittals: any[] = [];
  const seen: Record<string, boolean> = {};
  const latestFor = (code: string) => records
    .filter((r: any) => r.boqCode === code)
    .sort((a: any, b: any) => (Number(b.rev) || 0) - (Number(a.rev) || 0))[0] || null;
  const row = async (category: string, no: string, description: string, rec: any) => {
    const decision = rec ? decisionOfRec(rec) : null;
    return {
      category,
      no,
      typeId: (rec && rec.typeId) || "",
      description,
      decision,
      submitted: !!rec,
      files: rec && decision && APPROVED.indexOf(decision) >= 0
        ? await signAll(
            [(sbAp[rec.id] || {}).doc].filter(Boolean).concat(rec.attachments || []),
          )
        : [],
    };
  };
  for (const line of ((ex.subsData || {}).checklist || [])) {
    if (!line || cats.indexOf(line.category) < 0 || off[line.code]) continue;
    // A line whose submittal was sent to other trades only is not his.
    const any = allSent.filter((r: any) => r.boqCode === line.code)
      .sort((a: any, b: any) => (Number(b.rev) || 0) - (Number(a.rev) || 0))[0];
    if (any && Array.isArray(any.subs) && any.subs.indexOf(trade) < 0) continue;
    const rec = latestFor(line.code);
    if (rec) seen[rec.id] = true;
    const no = rec ? `${String(rec.category || "").toUpperCase()}-${String(rec.seq || "").padStart(3, "0")}` : "";
    submittals.push(await row(line.category, no, (rec && rec.itemDescription) || line.title || line.code, rec));
  }
  for (const r of records) {
    if (seen[r.id]) continue;
    const no = `${String(r.category || "").toUpperCase()}-${String(r.seq || "").padStart(3, "0")}`;
    submittals.push(await row(r.category, no, r.itemDescription || r.scope || "", r));
  }

  const sd = [];
  const sdAp = ex.sdApprovals || {};
  for (const [code, row] of Object.entries<any>(ex.sdRows || {})) {
    if (((row || {}).subs || []).indexOf(trade) < 0) continue;
    const approvedByClient = !!sdAp[code];
    const ok = approvedByClient || APPROVED.indexOf(row.status) >= 0;
    sd.push({
      code,
      description: row.desc || "",
      status: approvedByClient ? "approved" : (row.status || "required"),
      files: ok
        ? await signAll([(sdAp[code] || {}).file || row.file].filter(Boolean))
        : [],
    });
  }

  const log = [];
  for (const u of ((ex.subsData?.logs || {})[trade] || [])) {
    log.push({ date: u.date, subject: u.subject, body: u.body, by: u.by || "", files: await signAll(u.atts || []) });
  }
  const specs = [];
  for (const sp of ((ex.subsData?.specs || {})[trade] || [])) {
    specs.push({ subject: sp.subject, body: sp.body, files: await signAll(sp.atts || []) });
  }

  const standards: any[] = [];
  for (const x of ((ex.subsData?.standards || {})[trade] || [])) {
    standards.push({
      text: x.text,
      done: !!x.done,
      date: x.date || "",
      note: x.note || "",
      cert: x.cert && x.cert.path ? (await signAll([x.cert]))[0] || null : null,
    });
  }

  const sign = (v: unknown) => {
    const str = JSON.stringify(v ?? null);
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  };
  const weekly = (ex.subsData?.weekly || {})[trade] || {};
  const marks = {
    log: sign(log.map((x: any) => [x.date, x.subject, x.body, (x.files || []).length])),
    weekly: sign(weekly),
    specs: sign(specs.map((x: any) => [x.subject, x.body, (x.files || []).length])),
    standards: sign(standards.map((x: any) => [x.text, x.done, x.date, x.note, !!x.cert])),
    submittal: sign(submittals.map((x: any) => [x.no, x.decision, x.submitted])),
    sd: sign(sd.map((x: any) => [x.code, x.status])),
  };

  return {
    marks,
    project: { id: grant.projectId },
    trade,
    submittals,
    sd,
    log,
    specs,
    standards,
    weekly,
  };
}


// ---------------------------------------------------------------------------
// 06.11.26 — the dashboard's live preview ("אפליקציות" > תצוגה מקדימה).
// The administrator's own sign-in stands in for the phone code: she sees the
// app exactly as a project manager / subcontractor would, on real projects,
// and nothing she does there is written. A team user sees only the projects
// given to them.
// ---------------------------------------------------------------------------
const OWNER_EMAIL = "marcella.kravitz@gmail.com";
const PREVIEW_READS = ["projects", "board", "tasks"];
async function previewOf(body: any): Promise<any> {
  const pv = body && body.preview;
  if (!pv) return null;
  const { data: who } = await db.auth.getUser(String(pv.accessToken || ""));
  const u: any = who?.user;
  const role = u?.app_metadata?.role;
  if (!u || (role !== "admin" && role !== "team")) return { bad: true };
  const email = String(u.email || "").toLowerCase();
  let allowed: string[] | null = null;
  if (role === "team" || email !== OWNER_EMAIL) {
    const { data } = await db.from("project_access").select("project_id").eq("user_id", u.id);
    allowed = (data || []).map((r: any) => String(r.project_id));
  }
  return { as: pv.as === "pm" ? "pm" : "sub", allowed, email };
}
function previewGrant(pv: any, projects: any[], meta: Record<string, any>, projectId: string, trade: string) {
  if (!projectId || (pv.allowed && pv.allowed.indexOf(projectId) < 0)) return null;
  const p = projects.filter((x: any) => x.id === projectId)[0];
  if (!p && !meta[projectId]) return null;
  return {
    projectId, trade: trade || "", name: "תצוגה מקדימה", company: "",
    canWrite: pv.as === "pm", isPm: pv.as === "pm", extras: (p && p.extras) || {}, preview: true,
  };
}

// ---------------------------------------------------------------------------
// 06.11.26 — ניהול משימות in the project managers' app. The board is the one
// the dashboard keeps (public.project_tasks, one row per project): the fixed
// tasks of the library (contacts-catalog: taskCats / taskFixed) plus the
// project's own. A project manager adds tasks, and changes the status and the
// notes of any task and adds updates to it; the wording, category, owner and
// due date he may change only on a task he opened himself.
//
// Every field changed carries its own time (fts), so the dashboard, saving the
// whole board, keeps what was changed here and the other way round.
// ---------------------------------------------------------------------------
const ilDay = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
const tuid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function loadCatalog() {
  const { data } = await db.from("app_state").select("value").eq("key", "contacts-catalog").maybeSingle();
  return parse(data?.value) || {};
}
function tasksView(doc: any, catalog: any) {
  const cats = (Array.isArray(catalog.taskCats) ? catalog.taskCats : [])
    .filter((c: any) => c && c.key && String(c.he || "").trim()).map((c: any) => ({ key: c.key, he: c.he }));
  const catKeys = cats.map((c: any) => c.key);
  const defs = (Array.isArray(catalog.taskFixed) ? catalog.taskFixed : [])
    .filter((d: any) => d && d.id && String(d.desc || "").trim() && catKeys.indexOf(d.category) >= 0);
  const defIds = defs.map((d: any) => d.id);
  const own: any[] = Array.isArray(doc.tasks) ? doc.tasks : [];
  const gone: string[] = Array.isArray(doc.gone) ? doc.gone : [];
  const byId: Record<string, any> = {};
  own.forEach((t) => { if (t && t.id) byId[t.id] = t; });
  const day = ilDay();
  const tasks = defs.map((d: any) => ({
    ...(byId[d.id] || { id: d.id, created: day, owner: "", due: "", status: "open", notes: "", updates: [] }),
    fixed: true, desc: d.desc, category: d.category,
  })).concat(own.filter((t) => t && t.id && defIds.indexOf(t.id) < 0 && !t.fixed && gone.indexOf(t.id) < 0));
  return { cats, tasks, defs };
}
async function editTasks(projectId: string, change: (doc: any) => any) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row } = await db.from("project_tasks").select("data, updated_at").eq("project_id", projectId).maybeSingle();
    const doc = JSON.parse(JSON.stringify((row && row.data) || {}));
    if (!Array.isArray(doc.tasks)) doc.tasks = [];
    const next = change(doc);
    const now = new Date().toISOString();
    if (!row) {
      const { error } = await db.from("project_tasks").insert({ project_id: projectId, data: next, updated_at: now, updated_by: "app" });
      if (!error) return next;
      continue;
    }
    const { data: done } = await db.from("project_tasks")
      .update({ data: next, updated_at: now, updated_by: "app" })
      .eq("project_id", projectId).eq("updated_at", row.updated_at).select("project_id");
    if (done && done.length) return next;
  }
  throw new Error("busy");
}
function taskOut(t: any, phone: string) {
  const mine = !!(t.createdBy && t.createdBy.phone && t.createdBy.phone === phone);
  return {
    id: t.id, category: t.category || "", desc: t.desc || "", owner: t.owner || "", due: t.due || "",
    status: t.status || "open", notes: t.notes || "", created: t.created || "",
    createdBy: t.createdBy ? { name: t.createdBy.name || "" } : null,
    doneAt: t.doneAt || "", doneBy: t.doneBy ? { name: t.doneBy.name || "" } : null,
    updates: (Array.isArray(t.updates) ? t.updates : []).map((u: any) => ({ id: u.id, date: u.date || "", text: u.text || "", by: typeof u.by === "string" ? (u.by.indexOf("@") > 0 ? u.by.split("@")[0] : u.by) : ((u.by && u.by.name) || "") })),
    fixed: !!t.fixed, mine, rfi: t.rfi ? (t.rfi.no || "") : "",
  };
}
const TASK_ST = ["open", "progress", "done", "info"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") return json({
    fn: "sub-portal", version: 43,
    push: !!VAPID_PUBLIC,
    publicLen: VAPID_PUBLIC.length,
    privateLen: VAPID_PRIVATE.length,
    subject: VAPID_SUBJECT,
  });

  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }

  try {
    const pv = await previewOf(body);
    if (pv && pv.bad) return json({ error: "unauthorised" }, 401);
    if (pv && PREVIEW_READS.indexOf(body.action) < 0) return json({ error: "preview" }, 403);

    if (body.action === "login") {
      const phone = normPhone(body.phone);
      const code = normCode(body.code);
      if (!phone || !code) return json({ error: "missing" }, 400);
      const [projects, meta] = await Promise.all([loadProjects(), loadMeta()]);
      let ok = false;
      let viaPin = false;
      if (/^\d{4}$/.test(code)) {
        const { data } = await db.from("subcontractor_pins").select("pin_hash").eq("phone", phone).maybeSingle();
        ok = !!data && data.pin_hash === await pinHash(phone, code);
        viaPin = ok;
      }
      const grants = grantsFor(projects, phone, ok ? null : code);
      if (!grants.length) return json({ error: "invalid" }, 401);
      const { data: existing } = await db.from("subcontractor_pins").select("phone").eq("phone", phone).maybeSingle();
      return json({
        token: await makeToken(phone),
        hasPin: !!existing || viaPin,
        isPm: grants.some((g: any) => g.isPm),
        projects: grants.map((g) => ({ id: g.projectId, trade: g.trade, isPm: !!g.isPm, ...(meta[g.projectId] || {}) })),
      });
    }

    if (body.action === "set-pin") {
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "bad-token" }, 401);
      const pin = String(body.pin || "").trim();
      if (!/^\d{4}$/.test(pin)) return json({ error: "pin must be four digits" }, 400);
      const grants = grantsFor(await loadProjects(), phone, null);
      if (!grants.length) return json({ error: "not-granted" }, 401);
      const { error } = await db.from("subcontractor_pins")
        .upsert({ phone, pin_hash: await pinHash(phone, pin), updated_at: new Date().toISOString() });
      if (error) return json({ error: String(error.message || error) }, 500);
      return json({ ok: true });
    }

    if (body.action === "add-log" || body.action === "set-week") {
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "bad-token" }, 401);
      const grants = grantsFor(await loadProjects(), phone, null);
      const grant = grants.filter((g) => g.projectId === body.projectId)[0];
      if (!grant) return json({ error: "not-granted" }, 401);
      if (!grant.canWrite) return json({ error: "read-only" }, 403);
      const trade = String(body.trade || grant.trade || "");
      if (!trade) return json({ error: "missing trade" }, 400);

      if (body.action === "add-log") {
        const subject = String(body.subject || "").trim();
        if (!subject) return json({ error: "missing subject" }, 400);
        const atts: any[] = [];
        for (const ph of (body.photos || []).slice(0, 6)) {
          try {
            const raw = String(ph.data || "").split(",").pop() || "";
            const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
            const type = ph.type || "image/jpeg";
            const safe = String(ph.name || "photo.jpg").replace(/[^\w.\-]+/g, "_").slice(-50);
            const path = `${grant.projectId}/subs-log/${trade}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
            const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
            if (!error) atts.push({ path, name: safe, type });
          } catch (e) { console.error("[sub-portal] photo", e); }
        }
        const entry = {
          id: "u-" + Date.now().toString(36),
          date: String(body.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(),
          by: grant.name || grant.company || "",
          subject,
          body: String(body.text || "").trim(),
          atts,
        };
        await editSubsRow(grant.projectId, (cur) => {
          cur.logs = cur.logs || {};
          cur.logs[trade] = (cur.logs[trade] || []).concat([entry]);
          return cur;
        });
        await notifyPhones(await phonesFor(grant.projectId, trade), grant.projectId, phone);
        return json({ ok: true });
      }

      const weekStart = String(body.weekStart || "").slice(0, 10);
      const day = Number(body.day);
      if (!weekStart || !(day >= 0 && day <= 5)) return json({ error: "bad week" }, 400);
      await editSubsRow(grant.projectId, (cur) => {
        cur.weekly = cur.weekly || {};
        cur.weekly[trade] = cur.weekly[trade] || {};
        const week = Array.from({ length: 6 }, (_, i) => (cur.weekly[trade][weekStart] || [])[i] || "");
        week[day] = String(body.text || "");
        cur.weekly[trade][weekStart] = week;
        return cur;
      });
      await notifyPhones(await phonesFor(grant.projectId, trade), grant.projectId, phone);
      return json({ ok: true });
    }

    if (body.action === "subscribe") {
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "bad-token" }, 401);
      const sub = body.subscription || {};
      if (!sub.endpoint) return json({ error: "missing endpoint" }, 400);
      await db.from("subs_push").upsert({
        endpoint: String(sub.endpoint),
        phone,
        project_id: body.projectId || null,
        keys: sub.keys || null,
      });
      return json({ ok: true });
    }
    if (body.action === "vapid") return json({ key: VAPID_PUBLIC });

    if (body.action === "test-push") {
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "bad-token" }, 401);
      const report = await notifyPhones([phone], String(body.projectId || ""));
      if (body.withToken) report.sample = await vapidHeader("https://web.push.apple.com/x");
      return json({ ok: true, report });
    }

    if (body.action === "unsubscribe") {
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "bad-token" }, 401);
      if (body.endpoint) await db.from("subs_push").delete().eq("endpoint", String(body.endpoint));
      else await db.from("subs_push").delete().eq("phone", phone);
      return json({ ok: true });
    }

    if (body.action === "announce") {
      const { data: who } = await db.auth.getUser(String(body.accessToken || ""));
      const role = who?.user?.app_metadata?.role || who?.user?.user_metadata?.role;
      if (!who?.user || role !== "admin") return json({ error: "unauthorised" }, 401);
      const report = await notifyPhones(await phonesFor(String(body.projectId || ""), String(body.trade || "")), String(body.projectId || ""));
      return json({ ok: true, report });
    }

    if (body.action === "projects" && pv) {
      const meta = await loadMeta();
      const ids = Object.keys(meta).filter((id) => !pv.allowed || pv.allowed.indexOf(id) >= 0);
      return json({
        preview: true,
        projects: ids.map((id) => ({ id, trade: "", isPm: pv.as === "pm", ...(meta[id] || {}) }))
          .sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || ""), "he")),
      });
    }

    if (body.action === "projects") {
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "bad-token" }, 401);
      const [projects, meta] = await Promise.all([loadProjects(), loadMeta()]);
      const grants = grantsFor(projects, phone, null as any);
      if (!grants.length) return json({ error: "not-granted" }, 401);
      return json({
        projects: grants.map((g) => ({ id: g.projectId, trade: g.trade, isPm: !!g.isPm, ...(meta[g.projectId] || {}) })),
      });
    }

    if (body.action === "board") {
      const phone = pv ? "" : await readToken(body.token);
      if (!pv && !phone) return json({ error: "unauthorised" }, 401);
      const [projects, meta, sdParts, schedParts, sbApProbe, sdApProbe] = await Promise.all([
        loadProjects(), loadMeta(), loadPart("project-sd"), loadPart("project-schedules"),
        loadPart("project-submittal-approvals"), loadPart("project-sd-approvals"),
      ]);
      const grant: any = pv
        ? previewGrant(pv, projects, meta, String(body.projectId || ""), String(body.trade || ""))
        : grantsFor(projects, phone as string, null as any).filter((g) => g.projectId === body.projectId)[0];
      if (!grant) return json({ error: "unauthorised" }, 401);
      if (!pv && grant.isPm && body.trade) grant.trade = String(body.trade);
      grant.extras = {
        ...grant.extras,
        sdRows: sdParts[grant.projectId] || grant.extras.sdRows || {},
        scheduleData: schedParts[grant.projectId] || grant.extras.scheduleData || {},
        submittalApprovals: sbApProbe[grant.projectId] || grant.extras.submittalApprovals || {},
        sdApprovals: sdApProbe[grant.projectId] || grant.extras.sdApprovals || {},
      };
      const out: any = await boardFor(grant);
      out.project = { id: grant.projectId, ...(meta[grant.projectId] || {}) };
      out.isPm = !!grant.isPm;
      out.canWrite = !!grant.canWrite;
      out.preview = !!pv;
      out.me = grant.name || grant.company || "";
      // 06.11.26 — the buttons the dashboard switched off for this kind of
      // user ("אפליקציות" > עריכה): app-config { pm: { hidden }, sub: { hidden } }.
      try {
        const { data: cfgRow } = await db.from("app_state").select("value").eq("key", "app-config").maybeSingle();
        const cfg = parse(cfgRow?.value);
        const part = (cfg || {})[grant.isPm ? "pm" : "sub"] || {};
        out.hidden = Array.isArray(part.hidden) ? part.hidden : [];
        // 06.11.26 — the row of up to four icons at the bottom of the home screen.
        out.bottom = Array.isArray(part.bottom) ? part.bottom.slice(0, 4) : null;
      } catch (_e) { out.hidden = []; }
      return json(out);
    }

    // 06.11.26 — ניהול משימות: project managers only.
    if (body.action === "tasks" || body.action === "task-save") {
      const phone = pv ? "" : await readToken(body.token);
      if (!pv && !phone) return json({ error: "bad-token" }, 401);
      const projectId = String(body.projectId || "");
      let grant: any = null;
      if (pv) grant = previewGrant(pv, await loadProjects(), await loadMeta(), projectId, "");
      else grant = grantsFor(await loadProjects(), phone as string, null).filter((g) => g.projectId === projectId)[0];
      if (!grant) return json({ error: "not-granted" }, 401);
      if (!grant.isPm) return json({ error: "pm-only" }, 403);
      const catalog = await loadCatalog();

      if (body.action === "tasks") {
        const { data: row } = await db.from("project_tasks").select("data").eq("project_id", projectId).maybeSingle();
        const v = tasksView((row && row.data) || {}, catalog);
        return json({ cats: v.cats, tasks: v.tasks.map((t: any) => taskOut(t, phone as string)), me: grant.name || "" });
      }

      const me = { name: grant.name || grant.company || "מנהל פרויקט", phone, via: "app" };
      const op = String(body.op || "");
      const f = body.fields || {};
      const now = Date.now();
      const stamp = (t: any, keys: string[]) => {
        t.fts = { ...(t.fts || {}) };
        keys.forEach((k) => { t.fts[k] = now; });
        t.ts = now;
      };
      let result: any = null;
      let refused = "";
      await editTasks(projectId, (doc) => {
        const v = tasksView(doc, catalog);
        if (op === "add") {
          const desc = String(f.desc || "").trim();
          if (!desc) { refused = "missing desc"; return doc; }
          const t: any = {
            id: tuid("t"), category: v.cats.some((c: any) => c.key === f.category) ? f.category : "",
            created: ilDay(), createdBy: me, desc: desc.slice(0, 2000),
            owner: String(f.owner || "").slice(0, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(String(f.due || "")) ? f.due : "",
            status: "open", notes: String(f.notes || "").slice(0, 4000), updates: [],
          };
          stamp(t, ["id", "category", "created", "createdBy", "desc", "owner", "due", "status", "notes", "updates"]);
          doc.tasks = doc.tasks.concat([t]);
          result = t;
          return doc;
        }
        const id = String(body.taskId || "");
        const shown = v.tasks.filter((t: any) => t.id === id)[0];
        if (!shown) { refused = "not-found"; return doc; }
        let t = doc.tasks.filter((x: any) => x && x.id === id)[0];
        if (!t) { t = { ...shown }; doc.tasks = doc.tasks.concat([t]); }
        const mine = !!(t.createdBy && t.createdBy.phone && t.createdBy.phone === phone);
        if (op === "patch") {
          const keys: string[] = [];
          const own = mine && !t.fixed;
          if (!own && (f.desc !== undefined || f.category !== undefined || f.owner !== undefined || f.due !== undefined)) {
            refused = "not-yours"; return doc;
          }
          if (f.status !== undefined && TASK_ST.indexOf(f.status) >= 0 && f.status !== t.status) {
            const was = t.status === "done";
            t.status = f.status; keys.push("status");
            t.doneAt = f.status === "done" ? (was && t.doneAt ? t.doneAt : ilDay()) : "";
            t.doneBy = f.status === "done" ? (was && t.doneBy ? t.doneBy : me) : null;
            keys.push("doneAt", "doneBy");
          }
          if (f.notes !== undefined) { t.notes = String(f.notes || "").slice(0, 4000); keys.push("notes"); }
          if (own) {
            if (f.desc !== undefined && String(f.desc).trim()) { t.desc = String(f.desc).trim().slice(0, 2000); keys.push("desc"); }
            if (f.category !== undefined) { t.category = v.cats.some((c: any) => c.key === f.category) ? f.category : ""; keys.push("category"); }
            if (f.owner !== undefined) { t.owner = String(f.owner || "").slice(0, 120); keys.push("owner"); }
            if (f.due !== undefined) { t.due = /^\d{4}-\d{2}-\d{2}$/.test(String(f.due || "")) ? f.due : ""; keys.push("due"); }
          }
          stamp(t, keys);
        } else if (op === "update") {
          const text = String(body.text || "").trim();
          if (!text) { refused = "missing text"; return doc; }
          t.updates = (Array.isArray(t.updates) ? t.updates : []).concat([{ id: tuid("u"), date: ilDay(), text: text.slice(0, 4000), by: me.name, via: "app" }]);
          stamp(t, ["updates"]);
        } else { refused = "bad op"; }
        result = t;
        return doc;
      });
      if (refused) return json({ error: refused }, refused === "not-yours" ? 403 : 400);
      return json({ ok: true, task: result ? taskOut(result, phone as string) : null });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[sub-portal]", e);
    return json({ error: "server", detail: String((e as any)?.message || e) }, 500);
  }
});
