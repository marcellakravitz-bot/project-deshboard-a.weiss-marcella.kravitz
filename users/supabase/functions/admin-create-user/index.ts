// Edge Function: admin-create-user (multi-action user management).
// All actions require the caller to be a logged-in admin. The secret
// service-role key stays here on the server, never in the browser.
//
// The invitation link is a courtesy, not the way in: corporate mail filters
// strip it often enough that a new user would be locked out with nothing to
// click. So every account is also given an opening password — the person's own
// address — and the app forces a real password to be chosen the first time it
// is used. That is what `must_change_password` marks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: who, error: whoErr } = await caller.auth.getUser();
    if (whoErr || !who?.user) return json({ error: "Not authenticated" }, 401);
    if (who.user.app_metadata?.role !== "admin") return json({ error: "Not authorized" }, 403);

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "invite";

    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      // 06.11.26 — "team": a dashboard user who works like the administrator on
      // the projects given to them, without the system menu (users/supabase/001_team_role.sql).
      const role = body.role === "contractor" ? "contractor" : body.role === "team" ? "team" : "client";
      const redirectTo = String(body.redirectTo || "");
      const projectIds = Array.isArray(body.projectIds) ? body.projectIds : [];
      const projectNames = Array.isArray(body.projectNames) ? body.projectNames : [];
      if (!email) return json({ error: "Email is required" }, 400);
      // 06.11.26 — which list the account belongs to: "team", "supervision",
      // "client" (architects / client). Kept beside the role.
      const kind = String(body.kind || (role === "team" ? "team" : "")).slice(0, 30);
      const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { role, kind, projects: projectNames.join(", ") } });
      if (error) return json({ error: error.message }, 400);
      // The role, and the opening password, in one write.
      //   password      — their own address, exactly as the invitation says.
      //   email_confirm — without it an invited account stays unconfirmed and
      //                   the password is refused at sign-in, which is the very
      //                   dead end this is meant to avoid.
      //   user_metadata — replaces the object wholesale, so the two values the
      //                   invitation just wrote are repeated here on purpose.
      await admin.auth.admin.updateUserById(inv.user.id, {
        app_metadata: { role },
        password: email,
        email_confirm: true,
        user_metadata: {
          role,
          kind,
          projects: projectNames.join(", "),
          must_change_password: true,
        },
      });
      await admin.from("profiles").update({ role }).eq("id", inv.user.id);
      if (projectIds.length) {
        await admin.from("project_access").upsert(projectIds.map((pid: string) => ({ user_id: inv.user.id, project_id: pid, role, email })));
      }
      return json({ ok: true, userId: inv.user.id });
    }

    // Put a locked-out user back to the opening password. Nothing is emailed:
    // the administrator tells them, and the app makes them choose a new one the
    // moment they use it. Everything else about the account is left alone.
    if (action === "resetTemp") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json({ error: "Email is required" }, 400);
      const { data: list, error: listErr } = await admin.auth.admin.listUsers();
      if (listErr) return json({ error: listErr.message }, 400);
      const found = (list.users || []).find((u: any) => String(u.email || "").toLowerCase() === email);
      if (!found) return json({ error: "No such user" }, 404);
      const md = { ...(found.user_metadata || {}), must_change_password: true };
      const { error } = await admin.auth.admin.updateUserById(found.id, {
        password: email,
        email_confirm: true,
        user_metadata: md,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, userId: found.id });
    }

    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers();
      if (error) return json({ error: error.message }, 400);
      const now = Date.now();
      const users = (list.users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        role: (u.app_metadata && u.app_metadata.role) || "client",
        kind: (u.user_metadata && u.user_metadata.kind) || "",
        banned: !!(u.banned_until && new Date(u.banned_until).getTime() > now),
        created_at: u.created_at || u.invited_at || null,
        // So the user list can show who has not been in yet.
        must_change_password: !!(u.user_metadata && u.user_metadata.must_change_password),
      }));
      const { data: access } = await admin.from("project_access").select("user_id, project_id");
      return json({ ok: true, users, access: access || [] });
    }

    if (action === "delete") {
      if (!body.userId) return json({ error: "userId required" }, 400);
      const { error } = await admin.auth.admin.deleteUser(body.userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "setEnabled") {
      if (!body.userId) return json({ error: "userId required" }, 400);
      const enabled = !!body.enabled;
      await admin.auth.admin.updateUserById(body.userId, { ban_duration: enabled ? "none" : "876000h" });
      if (enabled) {
        const { data: u } = await admin.auth.admin.getUserById(body.userId);
        const md = (u && u.user && u.user.user_metadata) || {};
        md.disclaimer_version = null;
        md.disclaimer_ok = null;
        await admin.auth.admin.updateUserById(body.userId, { user_metadata: md });
      }
      return json({ ok: true });
    }

    if (action === "setAccess") {
      if (!body.userId) return json({ error: "userId required" }, 400);
      await admin.from("project_access").delete().eq("user_id", body.userId);
      const projectIds = Array.isArray(body.projectIds) ? body.projectIds : [];
      if (projectIds.length) {
        await admin.from("project_access").insert(projectIds.map((pid: string) => ({ user_id: body.userId, project_id: pid, role: body.role || "client", email: body.email })));
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});