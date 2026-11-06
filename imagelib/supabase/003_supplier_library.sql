-- ---------------------------------------------------------------------------
-- supplier_library — the suppliers' library (מאגר ספקים), shared by every
-- project. 06.11.2026.
--
-- One row per supplier:
--   name                the supplier as it is written on the boards
--   data.service        the service / warranty department (פרטי מחלקת בדק):
--                       { name, phone, mobile, email }
--   data.products       product folders: [{ id, name, files: [
--                         { id, name, path, size, addedAt,
--                           ai: { fields, at } | null } ] }]
--                       path is in the "submittals" bucket under library/…;
--                       ai is what the submittal AI read out of the file the
--                       first time, so choosing the file again needs no new
--                       AI run.
-- Read: every signed-in user (the submittal form picks from it).
-- Write: the administrator only.
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_library (
  id text primary key,
  name text not null default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
create index if not exists supplier_library_name on public.supplier_library (lower(name));

alter table public.supplier_library enable row level security;
drop policy if exists supplier_library_read on public.supplier_library;
create policy supplier_library_read on public.supplier_library for select to authenticated using (true);
drop policy if exists supplier_library_write on public.supplier_library;
create policy supplier_library_write on public.supplier_library for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.supplier_library to authenticated;
grant select, insert, update, delete on public.supplier_library to service_role;
