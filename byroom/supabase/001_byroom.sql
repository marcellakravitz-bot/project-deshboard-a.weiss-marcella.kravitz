-- =============================================================================
--  By Room — database objects. A. Weiss project dashboard.
--  Everything here is new and prefixed byroom_. Nothing existing is altered:
--  app_state, project_access, profiles and their policies are only READ
--  (through public.is_admin()).
--
--  Three layers of data:
--    uploaded   byroom_plan_sets, byroom_plan_files, byroom_parse_jobs
--    proposed   byroom_room_sources, byroom_room_review, byroom_plan_views, byroom_floor_maps
--    approved   byroom_rooms, byroom_room_finishes, byroom_room_versions, byroom_room_approvals
--  plus byroom_room_links (QR keys).
--
--  Nothing reaches the approved layer except through byroom_approve_items(),
--  which only the administrator can run, and only for rows she ticked.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- uploaded
create table if not exists public.byroom_plan_sets (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  floor          text not null,
  name           text not null,                       -- e.g. "August 2026"
  revision       text,
  revision_date  date,
  status         text not null default 'draft'
                 check (status in ('draft','uploading','processing','review','partly_approved','approved','failed','archived')),
  created_by     uuid default auth.uid(),
  created_email  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  processed_at   timestamptz,
  note           text
);
create index if not exists byroom_plan_sets_pf on public.byroom_plan_sets (project_id, floor, created_at desc);

create table if not exists public.byroom_plan_files (
  id             uuid primary key default gen_random_uuid(),
  set_id         uuid not null references public.byroom_plan_sets(id) on delete cascade,
  project_id     text not null,
  floor          text not null,
  plan_type      text not null check (plan_type in ('FL','FN','CL','MODEL','OTHER')),
  format         text not null check (format in ('pdf','dxf','rvt')),
  original_name  text not null,
  size_bytes     bigint not null,
  sha256         text,                                 -- of the original file, computed in the browser
  gzip_in_transit boolean not null default false,      -- DXF is compressed by the browser before upload
  object_path    text,                                 -- path in the work bucket
  archive_path   text,                                 -- PDF copy kept for viewing
  derived_path   text,                                 -- extracted data (small JSON)
  detected       jsonb not null default '{}'::jsonb,   -- what the system suggested (type, floor, revision) and why
  status         text not null default 'pending'
                 check (status in ('pending','uploading','uploaded','processing','ready','failed','removed')),
  upload_session text,                                 -- resumable upload URI (admin only)
  uploaded_by    uuid default auth.uid(),
  uploaded_at    timestamptz,
  error          text,
  keep           boolean not null default false,       -- "keep forever" ticked on the work-files screen
  purge_after    timestamptz,                          -- when the work file may be cleaned (never automatic)
  purged_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists byroom_plan_files_set on public.byroom_plan_files (set_id);
drop index if exists public.byroom_plan_files_dup;
create unique index if not exists byroom_plan_files_dup2 on public.byroom_plan_files (set_id, sha256) where sha256 is not null and status not in ('removed','failed');

create table if not exists public.byroom_parse_jobs (
  id             uuid primary key default gen_random_uuid(),
  set_id         uuid not null references public.byroom_plan_sets(id) on delete cascade,
  file_id        uuid references public.byroom_plan_files(id) on delete cascade,
  kind           text not null check (kind in ('parse','crosscheck')),
  status         text not null default 'queued' check (status in ('queued','running','done','failed')),
  worker_version text,
  execution      text,                                 -- Cloud Run execution name
  started_at     timestamptz,
  finished_at    timestamptz,
  integrity      jsonb,
  warnings       jsonb not null default '[]'::jsonb,
  metrics        jsonb,
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists byroom_parse_jobs_set on public.byroom_parse_jobs (set_id, created_at desc);

-- ---------------------------------------------------------------- proposed
-- One value one source found. Never edited; the trail behind every proposal.
create table if not exists public.byroom_room_sources (
  id          bigint generated always as identity primary key,
  set_id      uuid not null references public.byroom_plan_sets(id) on delete cascade,
  file_id     uuid not null references public.byroom_plan_files(id) on delete cascade,
  job_id      uuid references public.byroom_parse_jobs(id) on delete set null,
  room_no     text,                                   -- null = found but not assigned to a room
  field       text not null check (field in ('room','name','area','boundary','location','FL','FN','CL')),
  value       text,
  geom        jsonb,                                  -- polygon for a boundary
  x           double precision,                       -- position in DXF coordinates (cm)
  y           double precision,
  method      text,                                   -- inside boundary / leader / proximity / tag / model
  confidence  text check (confidence in ('certain','estimated','review','not_found','unassigned')),
  note        text
);
create index if not exists byroom_room_sources_set on public.byroom_room_sources (set_id, room_no);

-- One field of one room after the cross-check: the line she ticks.
create table if not exists public.byroom_room_review (
  id           bigint generated always as identity primary key,
  set_id       uuid not null references public.byroom_plan_sets(id) on delete cascade,
  project_id   text not null,
  floor        text not null,
  room_no      text not null,
  field        text not null check (field in ('room','name','area','boundary','FL','FN','CL')),
  proposed     jsonb,                                 -- {"value": ..., "codes": [...], "poly": ..., "x":..,"y":..}
  current      jsonb,                                 -- the approved value today (null = none)
  change_type  text not null check (change_type in ('new','changed','removed','same')),
  status       text not null check (status in ('certain','estimated','conflict','missing','single')),
  rvt_verified boolean not null default false,
  sources      jsonb not null default '[]'::jsonb,    -- [{"file":..,"src":"DXF|PDF|RVT","value":..,"how":..}]
  note         text,
  decision     text not null default 'pending' check (decision in ('pending','approved','unchanged')),
  decided_by   uuid,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists byroom_room_review_set on public.byroom_room_review (set_id, room_no);

-- The DXF -> PDF page transform, so a room can be marked on the plan sheet.
create table if not exists public.byroom_plan_views (
  id         bigint generated always as identity primary key,
  set_id     uuid not null references public.byroom_plan_sets(id) on delete cascade,
  file_id    uuid not null references public.byroom_plan_files(id) on delete cascade,
  page       int not null default 1,
  transform  jsonb not null,                          -- 3x2 affine, DXF cm -> PDF points
  method     text,
  fit_error  double precision,
  page_size  jsonb,
  created_at timestamptz not null default now()
);

-- The light floor map for phones: walls + one shape (or dot) per room. About 35 KB a floor.
create table if not exists public.byroom_floor_maps (
  id         bigint generated always as identity primary key,
  set_id     uuid not null references public.byroom_plan_sets(id) on delete cascade,
  project_id text not null,
  floor      text not null,
  data       jsonb not null,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists byroom_floor_maps_pf on public.byroom_floor_maps (project_id, floor) where approved;

-- ---------------------------------------------------------------- approved
create table if not exists public.byroom_rooms (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null,
  floor       text not null,
  room_no     text not null,                           -- the QR points at project + floor + this
  name        text,
  area        numeric,
  boundary    jsonb,
  x           double precision,
  y           double precision,
  status      text not null default 'active' check (status in ('active','removed')),
  last_set_id uuid references public.byroom_plan_sets(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (project_id, floor, room_no)
);

create table if not exists public.byroom_room_finishes (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.byroom_rooms(id) on delete cascade,
  kind       text not null check (kind in ('FL','FN','CL')),
  code       text not null,
  sources    jsonb not null default '[]'::jsonb,
  confidence text,
  review_id  bigint references public.byroom_room_review(id) on delete set null,
  set_id     uuid references public.byroom_plan_sets(id) on delete set null,
  unique (room_id, kind, code)
);

create table if not exists public.byroom_room_versions (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.byroom_rooms(id) on delete cascade,
  set_id     uuid references public.byroom_plan_sets(id) on delete set null,
  snapshot   jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists byroom_room_versions_room on public.byroom_room_versions (room_id, created_at desc);

create table if not exists public.byroom_room_approvals (
  id             bigint generated always as identity primary key,
  set_id         uuid references public.byroom_plan_sets(id) on delete set null,
  approved_by    uuid default auth.uid(),
  approved_email text,
  approved_at    timestamptz not null default now(),
  items          jsonb not null,                      -- [{"id":..,"room":..,"field":..,"before":..,"after":..}]
  left_pending   int not null default 0
);

create table if not exists public.byroom_room_links (
  id         bigint generated always as identity primary key,
  project_id text not null,
  project_name text,                                  -- shown on the phone page (copied when the key is made)
  token      text not null unique default replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists byroom_room_links_project on public.byroom_room_links (project_id) where revoked_at is null;

-- ---------------------------------------------------------------- access
-- The administrator reads and writes everything here. Nobody else reads these tables at all:
-- a QR viewer gets one approved room through the byroom-public function, never the tables.
do $$
declare t text;
begin
  foreach t in array array['byroom_plan_sets','byroom_plan_files','byroom_parse_jobs','byroom_room_sources',
    'byroom_room_review','byroom_plan_views','byroom_floor_maps','byroom_rooms','byroom_room_finishes',
    'byroom_room_versions','byroom_room_approvals','byroom_room_links']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- Signed-in project members (client, contractor) may READ the approved layer of their own projects,
-- so the By Room cube can show it inside the dashboard. Still view only.
drop policy if exists byroom_rooms_member_read on public.byroom_rooms;
create policy byroom_rooms_member_read on public.byroom_rooms for select to authenticated
  using (status = 'active' and public.can_touch_project(project_id));
drop policy if exists byroom_room_finishes_member_read on public.byroom_room_finishes;
create policy byroom_room_finishes_member_read on public.byroom_room_finishes for select to authenticated
  using (exists (select 1 from public.byroom_rooms r where r.id = room_id and r.status = 'active' and public.can_touch_project(r.project_id)));
drop policy if exists byroom_floor_maps_member_read on public.byroom_floor_maps;
create policy byroom_floor_maps_member_read on public.byroom_floor_maps for select to authenticated
  using (approved and public.can_touch_project(project_id));

-- ---------------------------------------------------------------- approval
-- Approve the ticked review rows of one set, all or nothing.
-- name/area/boundary/room rows write the room; FL/FN/CL rows replace that kind of finish in the room.
create or replace function public.byroom_approve_items(p_set uuid, p_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.byroom_plan_sets%rowtype;
  it       public.byroom_room_review%rowtype;
  rid      uuid;
  done     jsonb := '[]'::jsonb;
  touched  uuid[] := '{}';
  pending  int;
  before   jsonb;
begin
  if not public.is_admin() then
    raise exception 'only the administrator approves By Room changes';
  end if;
  select * into s from public.byroom_plan_sets where id = p_set for update;
  if not found then raise exception 'unknown plan set'; end if;

  for it in
    select * from public.byroom_room_review
    where set_id = p_set and id = any(p_ids) and decision = 'pending'
    order by (field = 'room') desc, id
  loop
    -- every approval needs the room row; approving any field of a new room creates it
    select id into rid from public.byroom_rooms where project_id = s.project_id and floor = s.floor and room_no = it.room_no;
    if rid is null then
      insert into public.byroom_rooms (project_id, floor, room_no, last_set_id)
      values (s.project_id, s.floor, it.room_no, p_set) returning id into rid;
    end if;
    select to_jsonb(r) - 'id' into before from public.byroom_rooms r where r.id = rid;

    if it.field = 'room' then
      update public.byroom_rooms set status = case when it.change_type = 'removed' then 'removed' else 'active' end,
             last_set_id = p_set, updated_at = now() where id = rid;
    elsif it.field = 'name' then
      update public.byroom_rooms set name = it.proposed ->> 'value', last_set_id = p_set, updated_at = now() where id = rid;
    elsif it.field = 'area' then
      update public.byroom_rooms set area = nullif(it.proposed ->> 'value', '')::numeric, last_set_id = p_set, updated_at = now() where id = rid;
    elsif it.field = 'boundary' then
      update public.byroom_rooms set boundary = it.proposed -> 'poly',
             x = coalesce((it.proposed ->> 'x')::double precision, x),
             y = coalesce((it.proposed ->> 'y')::double precision, y),
             last_set_id = p_set, updated_at = now() where id = rid;
    else  -- FL / FN / CL
      select coalesce(jsonb_agg(code order by code), '[]'::jsonb) into before
        from public.byroom_room_finishes where room_id = rid and kind = it.field;
      delete from public.byroom_room_finishes where room_id = rid and kind = it.field;
      insert into public.byroom_room_finishes (room_id, kind, code, sources, confidence, review_id, set_id)
      select rid, it.field, c, it.sources, it.status, it.id, p_set
      from jsonb_array_elements_text(coalesce(it.proposed -> 'codes', '[]'::jsonb)) as c;
      update public.byroom_rooms set last_set_id = p_set, updated_at = now() where id = rid;
    end if;

    update public.byroom_room_review set decision = 'approved', decided_by = auth.uid(), decided_at = now() where id = it.id;
    done := done || jsonb_build_object('id', it.id, 'room', it.room_no, 'field', it.field, 'before', before, 'after', it.proposed);
    touched := array_append(touched, rid);
  end loop;

  -- every ticked row was already replaced by a newer cross-check: nothing to do, nothing recorded
  if jsonb_array_length(done) = 0 then
    select count(*) into pending from public.byroom_room_review where set_id = p_set and decision = 'pending';
    return jsonb_build_object('approved', 0, 'pending', pending, 'note', 'the ticked rows are no longer current — reload the review');
  end if;

  -- a snapshot of every room this approval touched, so an older state can be opened later
  insert into public.byroom_room_versions (room_id, set_id, snapshot)
  select r.id, p_set, to_jsonb(r) || jsonb_build_object('finishes',
         coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'code', f.code) order by f.kind, f.code)
                   from public.byroom_room_finishes f where f.room_id = r.id), '[]'::jsonb))
  from public.byroom_rooms r where r.id = any(touched);

  select count(*) into pending from public.byroom_room_review where set_id = p_set and decision = 'pending';
  insert into public.byroom_room_approvals (set_id, approved_email, items, left_pending)
  values (p_set, auth.jwt() ->> 'email', done, pending);

  -- the set's floor map becomes the floor's map once anything in it is approved
  -- (only when this set has a map: a set without one must not hide the floor's current map)
  if exists (select 1 from public.byroom_floor_maps where set_id = p_set) then
    update public.byroom_floor_maps set approved = (set_id = p_set) where project_id = s.project_id and floor = s.floor;
  end if;
  update public.byroom_plan_sets set status = case when pending = 0 then 'approved' else 'partly_approved' end, updated_at = now()
   where id = p_set;
  -- work files of this set may be cleaned 30 days after the approval (never automatically: the admin clicks)
  update public.byroom_plan_files set purge_after = now() + interval '30 days'
   where set_id = p_set and format in ('dxf','rvt') and purge_after is null and not keep;

  return jsonb_build_object('approved', jsonb_array_length(done), 'pending', pending);
end $$;

revoke all on function public.byroom_approve_items(uuid, bigint[]) from public, anon;
grant execute on function public.byroom_approve_items(uuid, bigint[]) to authenticated;

-- ---------------------------------------------------------------- table rights (25.10.2026)
-- This project does not give new tables to the API roles by default, so RLS alone is not enough:
-- the signed-in user (filtered by the policies above) and the functions' service role need these.
do $$
declare t text;
begin
  foreach t in array array['byroom_plan_sets','byroom_plan_files','byroom_parse_jobs','byroom_room_sources',
    'byroom_room_review','byroom_plan_views','byroom_floor_maps','byroom_rooms','byroom_room_finishes',
    'byroom_room_versions','byroom_room_approvals','byroom_room_links']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
do $$
declare s text;
begin
  for s in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'byroom\_%'
  loop
    execute format('grant usage, select on sequence public.%I to authenticated, service_role', s);
  end loop;
end $$;
