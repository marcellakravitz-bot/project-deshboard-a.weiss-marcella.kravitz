-- =============================================================================
--  By Room — 002: publish step, mark catalogue, any mark category, manual marks.
--  25.10.2026 · approved by Marcella. Only byroom_* objects are touched.
--
--  * "אישור שינויים מסומנים" writes the approved layer (as before). The client and the QR
--    page no longer read it: they read byroom_published, which changes only when the
--    administrator presses "פרסום" (byroom_publish()).
--  * byroom_marks: what each mark of a project IS (name, description, photo, supplier,
--    status), copied from the LLI board by the dashboard. The QR page shows it, and the
--    processing job reads it to know which codes on a plan are marks.
--  * marks are no longer limited to FL / FN / CL: any category (joinery, lighting, ...).
--  * a mark the plans missed can be added to a room by hand (byroom_add_mark), logged.
--  Idempotent: safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------- columns
alter table public.byroom_plan_sets add column if not exists remarks text;
alter table public.byroom_plan_sets add column if not exists published_at timestamptz;
alter table public.byroom_room_finishes add column if not exists source text not null default 'plan';
alter table public.byroom_room_finishes add column if not exists added_email text;
alter table public.byroom_room_finishes add column if not exists added_at timestamptz;
alter table public.byroom_room_approvals add column if not exists project_id text;
alter table public.byroom_room_approvals add column if not exists floor text;
update public.byroom_room_approvals a set project_id = s.project_id, floor = s.floor
  from public.byroom_plan_sets s where a.set_id = s.id and a.project_id is null;
create index if not exists byroom_room_approvals_pf on public.byroom_room_approvals (project_id, floor, approved_at desc);

-- ---------------------------------------------------------------- any mark category
-- FL / FN / CL keep their names (flooring / wall finishes / ceiling); every other category is its own key.
alter table public.byroom_room_review drop constraint if exists byroom_room_review_field_check;
alter table public.byroom_room_review add constraint byroom_room_review_field_check check (field ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$');
alter table public.byroom_room_sources drop constraint if exists byroom_room_sources_field_check;
alter table public.byroom_room_sources add constraint byroom_room_sources_field_check check (field ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$');
alter table public.byroom_room_finishes drop constraint if exists byroom_room_finishes_kind_check;
alter table public.byroom_room_finishes add constraint byroom_room_finishes_kind_check check (kind ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$');
alter table public.byroom_room_finishes drop constraint if exists byroom_room_finishes_source_check;
alter table public.byroom_room_finishes add constraint byroom_room_finishes_source_check check (source in ('plan','manual'));

-- ---------------------------------------------------------------- new tables
create table if not exists public.byroom_projects (
  project_id      text primary key,
  name            text,
  meta            jsonb not null default '{}'::jsonb,   -- colours, logos, category names — what the QR page shows
  published_at    timestamptz,
  published_email text
);

create table if not exists public.byroom_marks (
  project_id  text not null,
  code        text not null,                           -- upper case, as the plans print it
  category    text not null,
  name        text,
  description text,
  image       text,                                    -- small photo (data URL), from LLI
  supplier    text,
  status      text,
  source      text,                                    -- lli / room list
  updated_at  timestamptz not null default now(),
  primary key (project_id, code)
);

create table if not exists public.byroom_published (
  id              bigint generated always as identity primary key,
  project_id      text not null,
  floor           text not null,
  data            jsonb not null,                      -- {map, rooms:[{n,name,area,items:[{kind,code}]}]}
  current         boolean not null default true,
  published_at    timestamptz not null default now(),
  published_email text
);
create unique index if not exists byroom_published_cur on public.byroom_published (project_id, floor) where current;

-- ---------------------------------------------------------------- access
do $$
declare t text;
begin
  foreach t in array array['byroom_projects','byroom_marks','byroom_published'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
create policy byroom_projects_member_read on public.byroom_projects for select to authenticated using (public.can_touch_project(project_id));
create policy byroom_marks_member_read on public.byroom_marks for select to authenticated using (public.can_touch_project(project_id));
create policy byroom_published_member_read on public.byroom_published for select to authenticated using (current and public.can_touch_project(project_id));
grant usage, select on sequence public.byroom_published_id_seq to authenticated, service_role;

-- A client now sees only what was published, never the approved layer directly.
drop policy if exists byroom_rooms_member_read on public.byroom_rooms;
drop policy if exists byroom_room_finishes_member_read on public.byroom_room_finishes;
drop policy if exists byroom_floor_maps_member_read on public.byroom_floor_maps;

-- ---------------------------------------------------------------- approval (now also records project and floor)
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
    else  -- a mark category: the plan's codes replace the plan's codes of that category; marks added by hand stay
      select coalesce(jsonb_agg(code order by code), '[]'::jsonb) into before
        from public.byroom_room_finishes where room_id = rid and kind = it.field;
      delete from public.byroom_room_finishes where room_id = rid and kind = it.field and source = 'plan';
      insert into public.byroom_room_finishes (room_id, kind, code, sources, confidence, review_id, set_id)
      select rid, it.field, c, it.sources, it.status, it.id, p_set
      from jsonb_array_elements_text(coalesce(it.proposed -> 'codes', '[]'::jsonb)) as c
      on conflict (room_id, kind, code) do nothing;
      update public.byroom_rooms set last_set_id = p_set, updated_at = now() where id = rid;
    end if;

    update public.byroom_room_review set decision = 'approved', decided_by = auth.uid(), decided_at = now() where id = it.id;
    done := done || jsonb_build_object('id', it.id, 'room', it.room_no, 'field', it.field, 'before', before, 'after', it.proposed);
    touched := array_append(touched, rid);
  end loop;

  if jsonb_array_length(done) = 0 then
    select count(*) into pending from public.byroom_room_review where set_id = p_set and decision = 'pending';
    return jsonb_build_object('approved', 0, 'pending', pending, 'note', 'the ticked rows are no longer current — reload the review');
  end if;

  insert into public.byroom_room_versions (room_id, set_id, snapshot)
  select r.id, p_set, to_jsonb(r) || jsonb_build_object('finishes',
         coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'code', f.code) order by f.kind, f.code)
                   from public.byroom_room_finishes f where f.room_id = r.id), '[]'::jsonb))
  from public.byroom_rooms r where r.id = any(touched);

  select count(*) into pending from public.byroom_room_review where set_id = p_set and decision = 'pending';
  insert into public.byroom_room_approvals (set_id, project_id, floor, approved_email, items, left_pending)
  values (p_set, s.project_id, s.floor, auth.jwt() ->> 'email', done, pending);

  if exists (select 1 from public.byroom_floor_maps where set_id = p_set) then
    update public.byroom_floor_maps set approved = (set_id = p_set) where project_id = s.project_id and floor = s.floor;
  end if;
  update public.byroom_plan_sets set status = case when pending = 0 then 'approved' else 'partly_approved' end, updated_at = now()
   where id = p_set;
  update public.byroom_plan_files set purge_after = now() + interval '30 days'
   where set_id = p_set and format in ('dxf','rvt') and purge_after is null and not keep;

  return jsonb_build_object('approved', jsonb_array_length(done), 'pending', pending);
end $$;
revoke all on function public.byroom_approve_items(uuid, bigint[]) from public, anon;
grant execute on function public.byroom_approve_items(uuid, bigint[]) to authenticated;

-- ---------------------------------------------------------------- a mark added or taken away by hand
create or replace function public.byroom_set_mark(p_project text, p_floor text, p_room text, p_kind text, p_code text, p_add boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid    uuid;
  before jsonb;
  after  jsonb;
  v_code text := upper(btrim(p_code));
begin
  if not public.is_admin() then raise exception 'only the administrator changes By Room data'; end if;
  if v_code = '' or p_kind !~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$' then raise exception 'mark code and category are required'; end if;
  select id into rid from public.byroom_rooms where project_id = p_project and floor = p_floor and room_no = p_room and status = 'active';
  if rid is null then raise exception 'room % is not an approved room on floor %', p_room, p_floor; end if;
  select coalesce(jsonb_agg(f.code order by f.code), '[]'::jsonb) into before from public.byroom_room_finishes f where f.room_id = rid and f.kind = p_kind;
  if p_add then
    insert into public.byroom_room_finishes (room_id, kind, code, source, added_email, added_at, confidence)
    values (rid, p_kind, v_code, 'manual', auth.jwt() ->> 'email', now(), 'certain')
    on conflict (room_id, kind, code) do nothing;
  else
    delete from public.byroom_room_finishes f where f.room_id = rid and f.kind = p_kind and upper(f.code) = v_code;
  end if;
  select coalesce(jsonb_agg(f.code order by f.code), '[]'::jsonb) into after from public.byroom_room_finishes f where f.room_id = rid and f.kind = p_kind;
  update public.byroom_rooms set updated_at = now() where id = rid;
  insert into public.byroom_room_approvals (set_id, project_id, floor, approved_email, items, left_pending)
  values (null, p_project, p_floor, auth.jwt() ->> 'email',
          jsonb_build_array(jsonb_build_object('room', p_room, 'field', p_kind, 'before', jsonb_build_object('codes', before),
            'after', jsonb_build_object('codes', after), 'manual', case when p_add then 'added' else 'removed' end, 'code', v_code)), 0);
  return jsonb_build_object('codes', after);
end $$;
revoke all on function public.byroom_set_mark(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.byroom_set_mark(text, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------- publish
-- Copies the approved layer of every floor of the project into byroom_published, in one step.
-- p_meta: {name, accent:{accent,accentInk,accentSoft}, clientLogo, brandLogo, categories:[{key,he,en}]}
create or replace function public.byroom_publish(p_project text, p_meta jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fl     text;
  n_fl   int := 0;
  n_room int := 0;
  rooms  jsonb;
  map    jsonb;
begin
  if not public.is_admin() then raise exception 'only the administrator publishes'; end if;
  insert into public.byroom_projects (project_id, name, meta, published_at, published_email)
  values (p_project, p_meta ->> 'name', coalesce(p_meta, '{}'::jsonb), now(), auth.jwt() ->> 'email')
  on conflict (project_id) do update set name = excluded.name, meta = excluded.meta, published_at = excluded.published_at,
                                         published_email = excluded.published_email;
  update public.byroom_published set current = false where project_id = p_project and current;
  for fl in select distinct r.floor from public.byroom_rooms r where r.project_id = p_project and r.status = 'active' loop
    select coalesce(jsonb_agg(jsonb_build_object('n', r.room_no, 'name', r.name, 'area', r.area,
             'items', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'code', f.code) order by f.kind, f.code)
                                from public.byroom_room_finishes f where f.room_id = r.id), '[]'::jsonb)) order by r.room_no), '[]'::jsonb)
      into rooms from public.byroom_rooms r where r.project_id = p_project and r.floor = fl and r.status = 'active';
    select m.data into map from public.byroom_floor_maps m where m.project_id = p_project and m.floor = fl and m.approved
      order by m.created_at desc limit 1;
    insert into public.byroom_published (project_id, floor, data, published_email)
    values (p_project, fl, jsonb_build_object('map', map, 'rooms', rooms), auth.jwt() ->> 'email');
    n_fl := n_fl + 1;
    n_room := n_room + jsonb_array_length(rooms);
  end loop;
  update public.byroom_plan_sets set published_at = now()
   where project_id = p_project and status in ('approved', 'partly_approved') and published_at is null;
  return jsonb_build_object('floors', n_fl, 'rooms', n_room);
end $$;
revoke all on function public.byroom_publish(text, jsonb) from public, anon;
grant execute on function public.byroom_publish(text, jsonb) to authenticated;
