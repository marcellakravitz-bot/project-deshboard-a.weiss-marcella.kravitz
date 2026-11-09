-- =============================================================================
--  By Room 003 (9.11.2026, byroom build 10 / worker 6)
--
--  byroom_room_notes    — the administrator's notes per room, from the room list. Internal: they go into the
--                         Excel / PDF reports, not to the client's link.
--  byroom_mark_choices  — "the plan says C-2, in this room it is C-2A": a variant picked in the room list.
--                         The processing job reads it, so later versions propose the chosen variant.
--
--  Keyed by project + floor + room number (not by room id), so a note or a choice survives a room that is
--  removed and read again. Administrator only, like every other byroom_ table.
--  Safe to run twice.
-- =============================================================================

create table if not exists public.byroom_room_notes (
  project_id     text not null,
  floor          text not null,
  room_no        text not null,
  note           text not null default '',
  updated_at     timestamptz not null default now(),
  updated_email  text,
  primary key (project_id, floor, room_no)
);

create table if not exists public.byroom_mark_choices (
  project_id     text not null,
  floor          text not null,
  room_no        text not null,
  kind           text not null,                       -- FL / FN / CL or a category key
  from_code      text not null,                       -- as read from the plans (C-2)
  to_code        text not null,                       -- what it is in this room (C-2A)
  chosen_at      timestamptz not null default now(),
  chosen_email   text,
  primary key (project_id, floor, room_no, kind, from_code)
);

do $$
declare t text;
begin
  foreach t in array array['byroom_room_notes','byroom_mark_choices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
