-- ---------------------------------------------------------------------------
-- image_library — one shared store of every picture uploaded anywhere on the
-- site (LLI, submittals, rooms, RFI, rejects), so any picture box can take a
-- picture "from the library" instead of from the computer. 05.11.2026.
--
-- data   the picture as the boards keep it (a JPEG data URL, ~640px)
-- hash   md5 of data — the same picture is kept once, whoever uploads it again
-- ---------------------------------------------------------------------------
create table if not exists public.image_library (
  id uuid primary key default gen_random_uuid(),
  hash text generated always as (md5(data)) stored,
  project_id text not null,
  project_name text not null default '',
  source text not null,
  label text not null default '',
  data text not null,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);
create unique index if not exists image_library_hash on public.image_library (hash);
create index if not exists image_library_created on public.image_library (created_at desc);

alter table public.image_library enable row level security;
drop policy if exists image_library_read on public.image_library;
create policy image_library_read on public.image_library for select to authenticated
  using (public.can_touch_project(project_id));
drop policy if exists image_library_add on public.image_library;
create policy image_library_add on public.image_library for insert to authenticated
  with check (public.can_touch_project(project_id));
drop policy if exists image_library_edit on public.image_library;
create policy image_library_edit on public.image_library for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists image_library_drop on public.image_library;
create policy image_library_drop on public.image_library for delete to authenticated
  using (public.is_admin());

-- 05.11.26: the table needs its grants too (new tables here get none by default)
grant select, insert, update, delete on public.image_library to authenticated;
grant select, insert, update, delete on public.image_library to service_role;
