// byroom-public — what a QR code or a room link opens. No sign-in; the project key in the link is the key.
// Returns only what the administrator PUBLISHED (byroom_published), never the approved layer in progress.
//
// GET ?k=<key>                     the project (name, colours, logos, category names) + every floor's room list (for search)
// GET ?k=<key>&f=<floor>           one floor: the map and its rooms with their marks (names only — light)
// GET ?k=<key>&f=<floor>&r=<room>  one room: every mark with its description, photo, supplier, status
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { cors, json } from "../_shared/gcp.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url);
    const k = u.searchParams.get("k") ?? "", floor = u.searchParams.get("f"), room = u.searchParams.get("r");
    const { data: link } = await sb.from("byroom_room_links").select("project_id, project_name").eq("token", k).is("revoked_at", null).maybeSingle();
    if (!link) return json({ error: "this link is no longer valid" }, 404);
    const pid = link.project_id;

    if (!floor) {
      const { data: proj } = await sb.from("byroom_projects").select("name, meta, published_at").eq("project_id", pid).maybeSingle();
      const { data: pubs } = await sb.from("byroom_published").select("floor, data").eq("project_id", pid).eq("current", true);
      const floors = (pubs ?? []).map((p) => ({ floor: p.floor, rooms: (p.data?.rooms ?? []).map((r: { n: string; name: string }) => ({ n: r.n, name: r.name })) }))
        .sort((a, b) => Number(a.floor) - Number(b.floor) || a.floor.localeCompare(b.floor));
      return json({ project: { name: proj?.name ?? link.project_name, ...(proj?.meta ?? {}), published_at: proj?.published_at ?? null }, floors });
    }

    const { data: pub } = await sb.from("byroom_published").select("data").eq("project_id", pid).eq("floor", floor).eq("current", true).maybeSingle();
    if (!pub) return json({ error: "nothing published for this floor" }, 404);
    const rooms = (pub.data?.rooms ?? []) as { n: string; name: string; area: number; items: { kind: string; code: string }[] }[];
    const codes = [...new Set(rooms.flatMap((r) => r.items.map((i) => i.code.toUpperCase())))];
    const { data: marks } = codes.length
      ? await sb.from("byroom_marks").select("code, category, name, description, image, supplier, status").eq("project_id", pid).in("code", codes)
      : { data: [] };
    const by = new Map((marks ?? []).map((m) => [m.code, m]));

    if (room) {
      const r = rooms.find((x) => x.n.toLowerCase() === room.toLowerCase());
      if (!r) return json({ room: null, error: "room not found on this floor" });
      return json({ floor, room: { n: r.n, name: r.name, area: r.area,
        items: r.items.map((i) => { const m = by.get(i.code.toUpperCase()); return { kind: i.kind, code: i.code, name: m?.name ?? null,
          description: m?.description ?? null, image: m?.image ?? null, supplier: m?.supplier ?? null, status: m?.status ?? null }; }) } });
    }
    return json({ floor, map: pub.data?.map ?? null,
      rooms: rooms.map((r) => ({ n: r.n, name: r.name, area: r.area,
        items: r.items.map((i) => ({ kind: i.kind, code: i.code, name: by.get(i.code.toUpperCase())?.name ?? null })) })) });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
