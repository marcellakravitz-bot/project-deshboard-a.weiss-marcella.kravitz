// ---------------------------------------------------------------------------
// sub-rejects — Rejects lists (ריג'קטים) for the subcontractor app.
// A. Weiss dashboard · 03.11.2026 · rejects build 1
//
// A function of its own, beside sub-portal, so the working sign-in server is
// not touched. It reads the same signed token sub-portal hands the phone (same
// SUBS_TOKEN_SECRET), and the same register of subcontractors (subsData.list).
//
//   project manager (pm)  every list of the project; may add lists, rows,
//                         photos, notes, and tick "טופל"
//   subcontractor         only the lists whose "viewers" include him; read only
//
// Deploy: Supabase → Edge Functions → new function "sub-rejects" → paste →
// Deploy, with "Verify JWT" OFF (the phone has no Supabase session; the token
// is checked here).
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUBS_SERVICE_KEY") || "";
const TOKEN_SECRET = Deno.env.get("SUBS_TOKEN_SECRET")!;
const BUCKET = "submittals";
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
async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
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

// Who this phone is on this project: the rows of the register that carry it.
async function whoOn(projectId: string, phone: string) {
  const keys = [`project-subs:${projectId}`, `project-extras:${projectId}`, "project-extras"];
  const { data } = await db.from("app_state").select("key, value").in("key", keys);
  const by: Record<string, any> = {};
  for (const r of (data || [])) by[r.key] = parse(r.value);
  const list = (by[`project-subs:${projectId}`] || {}).list
    || ((by[`project-extras:${projectId}`] || {}).subsData || {}).list
    || (((by["project-extras"] || {})[projectId] || {}).subsData || {}).list
    || [];
  const mine = (list || []).filter((s: any) => s && s.active !== false && normPhone(s.phone) === phone);
  if (!mine.length) return null;
  return {
    isPm: mine.some((s: any) => !!s.pm),
    ids: mine.map((s: any) => String(s.id || "")).filter(Boolean),
    name: mine.map((s: any) => s.name || s.company || "").filter(Boolean)[0] || "",
  };
}
const canSee = (who: any, l: any) => who.isPm || (Array.isArray(l.viewers) && l.viewers.some((v: string) => who.ids.indexOf(String(v)) >= 0));

async function signedPhotos(arr: any[]) {
  const out: any[] = [];
  for (const p of (arr || [])) {
    if (!p) continue;
    let url = null;
    if (p.path) {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(p.path, 3600);
      url = data?.signedUrl || null;
    }
    out.push({ id: p.id, thumb: p.thumb || "", url });
  }
  return out;
}
async function fullList(l: any) {
  const rows: any[] = [];
  for (const r of (Array.isArray(l.rows) ? l.rows : [])) {
    rows.push({
      id: r.id, floor: r.floor || "", desc: r.desc || "", owner: r.owner || "", due: r.due || "",
      done: !!r.done, notes: Array.isArray(r.notes) ? r.notes : [],
      photos: await signedPhotos(r.photos), plans: await signedPhotos(r.plans),
    });
  }
  return { id: l.id, name: l.name || "", list_date: l.list_date || "", attendees: l.attendees || "", rows };
}
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);   // Israel, near enough for a date stamp

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ fn: "sub-rejects", version: 1 });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }

  try {
    const phone = await readToken(body.token);
    if (!phone) return json({ error: "bad-token" }, 401);
    const projectId = String(body.projectId || "");
    if (!projectId) return json({ error: "missing project" }, 400);
    const who = await whoOn(projectId, phone);
    if (!who) return json({ error: "not-granted" }, 401);

    if (body.action === "lists") {
      const { data, error } = await db.from("rejects_lists")
        .select("id, name, list_date, attendees, rows, viewers, created_at").eq("project_id", projectId).order("created_at");
      if (error) throw error;
      const lists = (data || []).filter((l: any) => canSee(who, l)).map((l: any) => {
        const rows = Array.isArray(l.rows) ? l.rows : [];
        return { id: l.id, name: l.name || "", list_date: l.list_date || "", count: rows.length, done: rows.filter((r: any) => r && r.done).length };
      });
      return json({ isPm: who.isPm, lists });
    }

    if (body.action === "list") {
      const { data: l } = await db.from("rejects_lists").select("*").eq("id", String(body.listId || "")).eq("project_id", projectId).maybeSingle();
      if (!l || !canSee(who, l)) return json({ error: "not-found" }, 404);
      return json({ isPm: who.isPm, list: await fullList(l) });
    }

    // Everything below writes: project managers only.
    if (!who.isPm) return json({ error: "read-only" }, 403);

    if (body.action === "new-list") {
      const l = {
        id: uid("rl"), project_id: projectId, name: String(body.name || "").trim(), list_date: String(body.list_date || "").slice(0, 10) || today(),
        attendees: String(body.attendees || "").trim(), rows: [], cols: {}, viewers: [], updated_by: who.name || phone,
      };
      const { error } = await db.from("rejects_lists").insert(l);
      if (error) throw error;
      return json({ ok: true, id: l.id });
    }

    if (body.action === "save-row") {
      const listId = String(body.listId || "");
      // A short retry loop: two phones saving at once must not lose a row.
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data: l } = await db.from("rejects_lists").select("*").eq("id", listId).eq("project_id", projectId).maybeSingle();
        if (!l) return json({ error: "not-found" }, 404);
        const rows: any[] = Array.isArray(l.rows) ? l.rows : [];
        const inRow = body.row || {};
        let row = inRow.id ? rows.find((r: any) => r && r.id === inRow.id) : null;
        const isNew = !row;
        if (!row) row = { id: uid("r"), floor: "", desc: "", owner: "", due: "", photos: [], plans: [], notes: [], done: false };
        for (const k of ["floor", "desc", "owner", "due"]) if (k in inRow) row[k] = String(inRow[k] ?? "");
        if ("done" in inRow) row.done = !!inRow.done;
        // New photos: the full picture to storage, the thumbnail on the row.
        for (const ph of (Array.isArray(body.photos) ? body.photos : []).slice(0, 8)) {
          try {
            const raw = String(ph.data || "").split(",").pop() || "";
            const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
            const path = `${projectId}/rejects/${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
            const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
            row.photos = (row.photos || []).concat([{ id: uid("p"), path: error ? null : path, thumb: String(ph.thumb || ""), name: "photo.jpg" }]);
          } catch (e) { console.error("[sub-rejects] photo", e); }
        }
        const note = String(body.note || "").trim();
        if (note) row.notes = (row.notes || []).concat([{ id: uid("n"), at: today(), text: note, by: who.name || "" }]);
        const next = isNew ? rows.concat([row]) : rows.map((r: any) => (r && r.id === row.id ? row : r));
        const { data: done } = await db.from("rejects_lists")
          .update({ rows: next, updated_at: new Date().toISOString(), updated_by: who.name || phone })
          .eq("id", listId).eq("updated_at", l.updated_at).select("id");
        if (done && done.length) return json({ ok: true, rowId: row.id });
      }
      return json({ error: "busy" }, 409);
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[sub-rejects]", e);
    return json({ error: "server", detail: String((e as any)?.message || e) }, 500);
  }
});
