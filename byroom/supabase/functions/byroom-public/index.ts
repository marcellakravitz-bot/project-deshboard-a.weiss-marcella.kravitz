// byroom-public — what a QR code or a room link opens. No sign-in; the project key in the link is the key.
// Returns only APPROVED data of one project: the floor map, the room list, one room's details.
//
// GET ?k=<project key>&f=<floor>                 floor map + rooms of the floor
// GET ?k=<project key>&f=<floor>&r=<room>        + that room's details
// GET ?k=<project key>&f=<floor>&pdf=<FL|FN|CL>  a one-hour link to the approved PDF sheet
// GET ?k=<project key>                           list of floors
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { cors, env, json, signedUrl } from "../_shared/gcp.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url);
    const k = u.searchParams.get("k") ?? "", floor = u.searchParams.get("f"), room = u.searchParams.get("r"), pdf = u.searchParams.get("pdf");
    const { data: link } = await sb.from("byroom_room_links").select("project_id, project_name").eq("token", k).is("revoked_at", null).maybeSingle();
    if (!link) return json({ error: "this link is no longer valid" }, 404);
    const pid = link.project_id;

    if (!floor) {
      const { data } = await sb.from("byroom_floor_maps").select("floor").eq("project_id", pid).eq("approved", true);
      return json({ project: link.project_name, floors: [...new Set((data ?? []).map((r) => r.floor))].sort() });
    }

    const { data: map } = await sb.from("byroom_floor_maps").select("set_id, data").eq("project_id", pid).eq("floor", floor).eq("approved", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (pdf) {
      if (!map) return json({ error: "no approved plans for this floor" }, 404);
      const { data: f } = await sb.from("byroom_plan_files").select("archive_path, original_name").eq("set_id", map.set_id)
        .eq("format", "pdf").eq("plan_type", pdf).not("archive_path", "is", null).limit(1).maybeSingle();
      if (!f) return json({ error: "no sheet of this kind" }, 404);
      return json({ url: await signedUrl(env.archive(), f.archive_path, 3600, f.original_name) });
    }

    const { data: rooms } = await sb.from("byroom_rooms").select("id, room_no, name, area, x, y").eq("project_id", pid).eq("floor", floor).eq("status", "active");
    const out: Record<string, unknown> = {
      project: link.project_name, floor, map: map?.data ?? null,
      rooms: (rooms ?? []).map((r) => ({ n: r.room_no, name: r.name })),
    };
    if (map) {
      const { data: sheets } = await sb.from("byroom_plan_files").select("plan_type").eq("set_id", map.set_id).eq("format", "pdf").not("archive_path", "is", null);
      out.sheets = [...new Set((sheets ?? []).map((s) => s.plan_type))];
    }
    if (room) {
      const r = (rooms ?? []).find((x) => x.room_no.toLowerCase() === room.toLowerCase());
      if (!r) return json({ ...out, room: null, error: "room not found on this floor" }, 200);
      const { data: fin } = await sb.from("byroom_room_finishes").select("kind, code").eq("room_id", r.id).order("kind").order("code");
      out.room = { n: r.room_no, name: r.name, area: r.area, finishes: fin ?? [] };
    }
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
