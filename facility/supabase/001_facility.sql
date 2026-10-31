-- =============================================================================
--  תיק מתקן (Facility File) — database objects. A. Weiss project dashboard.
--  28.10.2026 · facility build 1 (site build 224)
--
--  One new table, one row per project. Nothing existing is altered: app_state,
--  project_access and profiles are only READ, through public.is_admin().
--  Administrator only — a client or contractor can neither read nor write it.
--  Safe to run more than once.
-- =============================================================================

create table if not exists public.facility_files (
  project_id  text primary key,
  data        jsonb not null default '{}'::jsonb,   -- checklist marks, suppliers, floors, message texts
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.facility_files enable row level security;

drop policy if exists facility_files_admin on public.facility_files;
create policy facility_files_admin on public.facility_files
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.facility_files from anon;
grant select, insert, update, delete on public.facility_files to authenticated;
