// byroom-admin — the administrator's server side of By Room.
// Only a signed-in user whose role is "admin" gets past the first check.
//
// actions (POST JSON {action, ...}):
//   start_upload  {file_id, origin}   create the resumable upload to Cloud Storage, return its address
//   finish_upload {file_id}           confirm the object arrived, start reading it
//   reprocess     {file_id}           read a file again
//   crosscheck    {set_id}            cross-check a set again
//   remove_file   {file_id}           take a file out of its set (its work object is deleted)
//   purge         {file_ids: [...]}   delete work files (DXF/RVT) the administrator chose to clean
//   pdf_url       {file_id}           a one-hour link to view an archived PDF
//   delete_set    {set_id}            delete a version and its files (refused once anything from it was approved)
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { cors, deleteObject, env, json, objectMeta, resumableSession, runJob, signedUrl } from "../_shared/gcp.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CT: Record<string, string> = { pdf: "application/pdf", dxf: "application/dxf", rvt: "application/octet-stream" };
const safe = (s: string) => s.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);

async function file(id: string) {
  const { data, error } = await sb.from("byroom_plan_files").select("*").eq("id", id).single();
  if (error || !data) throw new Error("file not found");
  return data;
}

async function startJob(vars: Record<string, string>, setId: string, fileId: string | null) {
  try {
    return await runJob(vars);
  } catch (e) {
    await sb.from("byroom_parse_jobs").insert({ set_id: setId, file_id: fileId, kind: fileId ? "parse" : "crosscheck", status: "failed",
      error: `the processing job could not be started: ${String(e).slice(0, 500)}` });
    if (fileId) await sb.from("byroom_plan_files").update({ status: "failed", error: "העיבוד לא התחיל — " + String(e).slice(0, 300) }).eq("id", fileId);
    await sb.from("byroom_plan_sets").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", setId);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user || u.user.app_metadata?.role !== "admin") return json({ error: "administrator only" }, 403);
    const body = await req.json();
    const a = body.action;

    if (a === "start_upload") {
      const f = await file(body.file_id);
      const object = f.object_path ?? `sets/${f.set_id}/${f.id}/${safe(f.original_name)}${f.gzip_in_transit ? ".gz" : ""}`;
      const ct = f.gzip_in_transit ? "application/gzip" : (CT[f.format] ?? "application/octet-stream");
      const session = await resumableSession(env.work(), object, ct, body.origin ?? req.headers.get("origin") ?? "");
      await sb.from("byroom_plan_files").update({ object_path: object, upload_session: session, status: "uploading", error: null }).eq("id", f.id);
      await sb.from("byroom_plan_sets").update({ status: "uploading", updated_at: new Date().toISOString() }).eq("id", f.set_id).in("status", ["draft", "review", "partly_approved", "approved", "failed"]);
      return json({ session, object });
    }

    if (a === "finish_upload" || a === "reprocess") {
      const f = await file(body.file_id);
      const meta = await objectMeta(env.work(), f.object_path);
      if (!meta) return json({ error: "the file did not arrive in storage — upload it again" }, 409);
      if (!f.gzip_in_transit && Number(meta.size) !== Number(f.size_bytes)) {
        return json({ error: `size differs (${meta.size} of ${f.size_bytes} bytes) — upload it again` }, 409);
      }
      await sb.from("byroom_plan_files").update({ status: "uploaded", uploaded_at: f.uploaded_at ?? new Date().toISOString(), upload_session: null, error: null }).eq("id", f.id);
      await sb.from("byroom_plan_sets").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", f.set_id);
      const execution = await startJob({ MODE: "parse", FILE_ID: f.id }, f.set_id, f.id);
      return json({ ok: true, execution });
    }

    if (a === "crosscheck") {
      await sb.from("byroom_plan_sets").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", body.set_id);
      const execution = await startJob({ MODE: "crosscheck", SET_ID: body.set_id }, body.set_id, null);
      return json({ ok: true, execution });
    }

    if (a === "remove_file") {
      const f = await file(body.file_id);
      if (f.object_path) await deleteObject(env.work(), f.object_path);
      await sb.from("byroom_plan_files").update({ status: "removed", purged_at: new Date().toISOString() }).eq("id", f.id);
      const { count } = await sb.from("byroom_plan_files").select("id", { count: "exact", head: true }).eq("set_id", f.set_id).eq("status", "ready");
      if (count) await startJob({ MODE: "crosscheck", SET_ID: f.set_id }, f.set_id, null);
      return json({ ok: true });
    }

    if (a === "purge") {
      const done: string[] = [];
      for (const id of body.file_ids ?? []) {
        const f = await file(id);
        if (f.format === "pdf" || f.keep || f.purged_at) continue;          // a PDF is the record of the revision: never cleaned
        if (f.object_path) await deleteObject(env.work(), f.object_path);
        await sb.from("byroom_plan_files").update({ purged_at: new Date().toISOString() }).eq("id", id);
        done.push(id);
      }
      return json({ purged: done });
    }

    // a whole version, with its files in storage. A version some changes were approved from stays, as the record.
    if (a === "delete_set") {
      const { data: set } = await sb.from("byroom_plan_sets").select("id, status").eq("id", body.set_id).single();
      if (!set) return json({ error: "version not found" }, 404);
      const { count } = await sb.from("byroom_room_review").select("id", { count: "exact", head: true }).eq("set_id", set.id).eq("decision", "approved");
      if (count || ["approved", "partly_approved"].includes(set.status)) return json({ error: "שינויים מהגרסה הזו כבר אושרו — היא נשמרת לתיעוד ואי אפשר למחוק אותה" }, 409);
      const { data: files } = await sb.from("byroom_plan_files").select("object_path, archive_path, derived_path").eq("set_id", set.id);
      for (const f of files ?? []) {
        if (f.object_path) await deleteObject(env.work(), f.object_path);
        if (f.derived_path) await deleteObject(env.work(), f.derived_path);
        if (f.archive_path) await deleteObject(env.archive(), f.archive_path);
      }
      const { error } = await sb.from("byroom_plan_sets").delete().eq("id", set.id);
      if (error) throw new Error(error.message);
      return json({ ok: true, files: (files ?? []).length });
    }

    if (a === "pdf_url") {
      const f = await file(body.file_id);
      if (f.format !== "pdf" || !f.archive_path) return json({ error: "no archived PDF for this file" }, 404);
      return json({ url: await signedUrl(env.archive(), f.archive_path, 3600, f.original_name) });
    }

    return json({ error: `unknown action ${a}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
