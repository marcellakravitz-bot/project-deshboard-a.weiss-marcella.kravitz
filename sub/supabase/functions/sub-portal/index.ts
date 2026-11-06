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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") return json({
    fn: "sub-portal", version: 27,
    push: !!VAPID_PUBLIC,
    publicLen: VAPID_PUBLIC.length,
    privateLen: VAPID_PRIVATE.length,
    subject: VAPID_SUBJECT,
  });

  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }

  try {
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
      const phone = await readToken(body.token);
      if (!phone) return json({ error: "unauthorised" }, 401);
      const [projects, meta, sdParts, schedParts, sbApProbe, sdApProbe] = await Promise.all([
        loadProjects(), loadMeta(), loadPart("project-sd"), loadPart("project-schedules"),
        loadPart("project-submittal-approvals"), loadPart("project-sd-approvals"),
      ]);
      const grants = grantsFor(projects, phone, null as any);
      const grant = grants.filter((g) => g.projectId === body.projectId)[0];
      if (!grant) return json({ error: "unauthorised" }, 401);
      if (grant.isPm && body.trade) grant.trade = String(body.trade);
      grant.extras = {
        ...grant.extras,
        sdRows: sdParts[grant.projectId] || grant.extras.sdRows || {},
        scheduleData: schedParts[grant.projectId] || grant.extras.scheduleData || {},
        submittalApprovals: sbApProbe[grant.projectId] || grant.extras.submittalApprovals || {},
        sdApprovals: sdApProbe[grant.projectId] || grant.extras.sdApprovals || {},
      };
      const out = await boardFor(grant);
      out.project = { id: grant.projectId, ...(meta[grant.projectId] || {}) };
      out.isPm = !!grant.isPm;
      out.canWrite = !!grant.canWrite;
      // 06.11.26 — the buttons the dashboard switched off for this kind of
      // user ("אפליקציות" > עריכה): app-config { pm: { hidden }, sub: { hidden } }.
      try {
        const { data: cfgRow } = await db.from("app_state").select("value").eq("key", "app-config").maybeSingle();
        const cfg = parse(cfgRow?.value);
        const part = (cfg || {})[grant.isPm ? "pm" : "sub"] || {};
        out.hidden = Array.isArray(part.hidden) ? part.hidden : [];
      } catch (_e) { out.hidden = []; }
      return json(out);
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[sub-portal]", e);
    return json({ error: "server", detail: String((e as any)?.message || e) }, 500);
  }
});
