-- =============================================================================
--  ריג'קטים (Rejects / punch lists) — database objects. A. Weiss dashboard
--  03.11.2026 · rejects build 1 (site build 233)
--
--  One row per list. The rows, notes and print choices live in jsonb; the
--  photos themselves live in the "submittals" bucket under
--  <projectId>/rejects/<listId>/, and a row only keeps the path and a small
--  thumbnail. Administrator only here; project managers on the phone reach it
--  through the sub-portal function (service role), never directly.
--  Nothing existing is altered. Safe to run more than once.
-- =============================================================================

create table if not exists public.rejects_lists (
  id          text primary key,
  project_id  text not null,
  name        text not null default '',
  list_date   date,
  attendees   text not null default '',
  rows        jsonb not null default '[]'::jsonb,   -- [{id, floor, desc, owner, due, photos[], plans[], notes[], done}]
  cols        jsonb not null default '{}'::jsonb,   -- which columns print
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists rejects_lists_project on public.rejects_lists (project_id, created_at);

alter table public.rejects_lists enable row level security;
drop policy if exists rejects_lists_admin on public.rejects_lists;
create policy rejects_lists_admin on public.rejects_lists
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.rejects_lists from anon;
grant select, insert, update, delete on public.rejects_lists to authenticated;
grant select, insert, update, delete on public.rejects_lists to service_role;

-- 03.11.26 — who may view a list in the subcontractor app (their ids in subsData.list).
alter table public.rejects_lists add column if not exists viewers jsonb not null default '[]'::jsonb;
