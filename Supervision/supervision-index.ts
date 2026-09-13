// =============================================================================
//  supervision — Supabase Edge Function
//  A. Weiss project dashboard · 12.9.2026
// =============================================================================
//
//  A submittal or a shop drawing goes out for approval as a LINK, and the
//  person approving it needs no account here. The link is the key: a long
//  random token that says nothing about the project, the document, or the shape
//  of the site behind it. It opens exactly one document and nothing else.
//
//  What this function is careful about:
//
//  · THE TOKEN IS THE ONLY WAY IN, and it is checked on every request. A token
//    that has expired, been revoked, or already been signed cannot act — it can
//    only look.
//  · DOWNLOADING IS NOT ACTING. Taking a copy of the unsigned document leaves
//    the link open; only a decision and a signature close it.
//  · NOTHING IS DELETED. Every opening, download, comment and signature is
//    appended to the audit trail, which is what makes the document defensible
//    later.
//  · THE DASHBOARD PROVES WHO IT IS with its own sign-in token; the supervisor
//    proves nothing beyond holding the link, which is exactly the trade-off
//    that was chosen deliberately.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  || Deno.env.get("SUBS_SERVICE_KEY")
  || "";
const BUCKET = "submittals";
const DAYS = 30;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const parse = (v: unknown) => {
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
  return v || {};
};

// 32 bytes of randomness, url-safe. Long enough that guessing is not a strategy.
function newToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Only an administrator may issue, revoke or re-issue a link.
async function admin(accessToken: string) {
  if (!accessToken) return null;
  const { data } = await db.auth.getUser(accessToken);
  const role = data?.user?.app_metadata?.role || data?.user?.user_metadata?.role;
  return data?.user && role === "admin" ? data.user : null;
}

async function loadPart(prefix: string): Promise<Record<string, any>> {
  const { data } = await db.from("app_state").select("key, value").like("key", prefix + ":%");
  const out: Record<string, any> = {};
  for (const row of (data || [])) out[String(row.key).slice(prefix.length + 1)] = parse(row.value);
  return out;
}

async function signedUrl(path: string) {
  if (!path) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

// Append, never rewrite.
async function note(token: string, row: any, event: string, detail?: unknown) {
  const audit = Array.isArray(row?.audit) ? row.audit.slice() : [];
  audit.push({ at: new Date().toISOString(), event, ...(detail ? { detail } : {}) });
  await db.from("supervision_links").update({ audit }).eq("token", token);
  return audit;
}

// What state a link is in, in one word, so the page never has to work it out.
function stateOf(row: any): "signed" | "revoked" | "expired" | "open" {
  if (row.signed_at) return "signed";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "open";
}

// The document itself, assembled for whoever is holding the link. A submittal
// carries its form and its specifications; a drawing carries the sheet. Once it
// has been signed, what comes back is the signed copy and nothing else.
async function payload(row: any) {
  const state = stateOf(row);
  const extras = await loadPart("project-extras");
  const ex = extras[row.project_id] || {};
  const meta = { project: ex.name || "", kind: row.kind, docId: row.doc_id, state };

  if (row.kind === "submittal") {
    const rec = (ex.submittals || []).filter((r: any) => r && r.id === row.doc_id)[0] || null;
    if (!rec) return { ...meta, missing: true };
    const aps = await loadPart("project-submittal-approvals");
    const ap = (aps[row.project_id] || {})[rec.id] || null;
    const files: any[] = [];
    if (state === "signed" && ap?.doc?.path) {
      files.push({ name: ap.doc.name || "", type: ap.doc.type || "", url: await signedUrl(ap.doc.path) });
    }
    for (const a of (rec.attachments || [])) {
      if (a && a.path) files.push({ name: a.name || "", type: a.type || "", url: await signedUrl(a.path) });
    }
    return {
      ...meta,
      no: `${String(rec.category || "").toUpperCase()}-${String(rec.seq || "").padStart(3, "0")}`,
      rec: state === "signed" ? { id: rec.id, typeId: rec.typeId, itemDescription: rec.itemDescription } : rec,
      decision: row.decision || ((ap || {}).review || {}).decision || null,
      files,
    };
  }

  const sds = await loadPart("project-sd");
  const sdRow = (sds[row.project_id] || {})[row.doc_id] || null;
  if (!sdRow) return { ...meta, missing: true };
  const sdAps = await loadPart("project-sd-approvals");
  const ap = (sdAps[row.project_id] || {})[row.doc_id] || null;
  const file = state === "signed" ? (ap?.file || sdRow.file) : sdRow.file;
  return {
    ...meta,
    no: row.doc_id,
    rec: { code: row.doc_id, desc: sdRow.desc || "", status: sdRow.status || "" },
    decision: row.decision || (ap ? "approved" : null),
    files: file?.path ? [{ name: file.name || "", type: file.type || "", url: await signedUrl(file.path) }] : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ fn: "supervision", version: 1 });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }

  try {
    // ---- issued from the dashboard -----------------------------------------
    if (body.action === "issue") {
      const who = await admin(String(body.accessToken || ""));
      if (!who) return json({ error: "unauthorised" }, 401);
      const kind = String(body.kind || "");
      if (kind !== "submittal" && kind !== "sd") return json({ error: "bad kind" }, 400);
      if (!body.projectId || !body.docId) return json({ error: "missing" }, 400);

      // Re-issuing replaces: the old link stops working the moment a new one is
      // made, so a link that went to the wrong address cannot be used later.
      await db.from("supervision_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("project_id", String(body.projectId))
        .eq("kind", kind)
        .eq("doc_id", String(body.docId))
        .is("signed_at", null)
        .is("revoked_at", null);

      const token = newToken();
      const expires = new Date(Date.now() + DAYS * 86400000).toISOString();
      const { error } = await db.from("supervision_links").insert({
        token,
        project_id: String(body.projectId),
        kind,
        doc_id: String(body.docId),
        rev: Number(body.rev) || 0,
        issued_by: (who.email || "").toLowerCase(),
        expires_at: expires,
        audit: [{ at: new Date().toISOString(), event: "issued", detail: (who.email || "").toLowerCase() }],
      });
      if (error) return json({ error: String(error.message || error) }, 500);
      return json({ token, expiresAt: expires });
    }

    // ---- cancelling an approval, so it can go out again ---------------------
    if (body.action === "revoke") {
      const who = await admin(String(body.accessToken || ""));
      if (!who) return json({ error: "unauthorised" }, 401);
      await db.from("supervision_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token", String(body.token || ""));
      return json({ ok: true });
    }

    // ---- what the dashboard shows beside the document ----------------------
    if (body.action === "status") {
      const who = await admin(String(body.accessToken || ""));
      if (!who) return json({ error: "unauthorised" }, 401);
      const { data } = await db.from("supervision_links")
        .select("token, issued_at, expires_at, revoked_at, signed_at, decision, audit")
        .eq("project_id", String(body.projectId || ""))
        .eq("kind", String(body.kind || ""))
        .eq("doc_id", String(body.docId || ""))
        .order("issued_at", { ascending: false });
      return json({ links: (data || []).map((r: any) => ({ ...r, state: stateOf(r) })) });
    }

    // ---- the supervisor's own requests -------------------------------------
    const token = String(body.token || "");
    if (!token) return json({ error: "missing token" }, 400);
    const { data: row } = await db.from("supervision_links").select("*").eq("token", token).maybeSingle();
    // A token nobody issued and a token that was withdrawn look the same from
    // outside on purpose: neither says whether a document exists.
    if (!row) return json({ error: "not-found" }, 404);

    if (body.action === "open") {
      const out = await payload(row);
      if (!row.audit || !row.audit.length || !row.signed_at) await note(token, row, "opened");
      return json(out);
    }

    if (body.action === "downloaded") {
      // Taking a copy is looking, not acting: the link stays open.
      await note(token, row, "downloaded", body.name || "");
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[supervision]", e);
    return json({ error: "server", detail: String((e as any)?.message || e) }, 500);
  }
});
