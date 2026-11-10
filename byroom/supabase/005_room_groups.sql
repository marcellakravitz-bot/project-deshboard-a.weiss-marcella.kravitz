-- =============================================================================
--  By Room 005 (10.11.2026, byroom build 17) — room groups ("אופן ספייס")
--
--  A group is a set of rooms on one floor with the same finishes. Its finishes are set once (the gear on the purple
--  row) and written to every member room, so the approved data stays per room and publishing works as before.
--  A member whose finishes stop matching the group (a mark added or removed in it) leaves the group.
--  The client sees the group name and its rooms (copied into the publish meta), the PDF prints one page per group.
--
--  The project's general notes (the appendix) live in byroom_room_notes with floor = '*' and room_no = '*'.
--  Administrator only, like every other byroom_ table. Safe to run twice.
-- =============================================================================

create table if not exists public.byroom_room_groups (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  floor          text not null,
  name           text not null,
  finishes       jsonb not null default '[]'::jsonb,   -- [{kind, code}]
  rooms          text[] not null default '{}',        -- room numbers on this floor
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_email  text
);
create index if not exists byroom_room_groups_pf on public.byroom_room_groups (project_id, floor);

do $$
declare t text := 'byroom_room_groups';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t || '_admin', t);
  execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('grant all on public.%I to service_role', t);
end $$;
