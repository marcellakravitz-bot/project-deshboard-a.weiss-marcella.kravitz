-- =============================================================================
--  ניהול משימות (Task management) — database objects. A. Weiss project dashboard.
--  06.11.2026 · tasks build 1 (site build 257)
--
--  One new table, one row per project. Nothing existing is altered: only
--  public.is_admin() is READ. Administrator only — a client, contractor or
--  subcontractor can neither read nor write it. Safe to run more than once.
-- =============================================================================

create table if not exists public.project_tasks (
  project_id  text primary key,
  data        jsonb not null default '{}'::jsonb,   -- { tasks: [{ id, category, created, desc, owner, due, status, notes, updates[] }] }
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.project_tasks enable row level security;

drop policy if exists project_tasks_admin on public.project_tasks;
create policy project_tasks_admin on public.project_tasks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.project_tasks from anon;
grant select, insert, update, delete on public.project_tasks to authenticated;
