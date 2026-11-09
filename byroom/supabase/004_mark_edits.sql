-- =============================================================================
--  By Room 004 (9.11.2026, byroom build 11)
--
--  byroom_mark_edits  — a mark's name / description as edited in By Room. It takes the place of what the LLI
--                       says, in By Room only (room list, reports, the client's link after publishing).
--                       The LLI itself is never written. Deleting the row returns to the LLI wording.
--  byroom_room_marks  — per mark in a room: the administrator's note and the green V
--                       ("checked 100% — this mark belongs to this room").
--
--  Administrator only, like every other byroom_ table. Safe to run twice.
-- =============================================================================

create table if not exists public.byroom_mark_edits (
  project_id     text not null,
  code           text not null,                        -- upper case, as By Room keys marks
  name           text,
  description    text,
  updated_at     timestamptz not null default now(),
  updated_email  text,
  primary key (project_id, code)
);

create table if not exists public.byroom_room_marks (
  project_id     text not null,
  floor          text not null,
  room_no        text not null,
  kind           text not null,
  code           text not null,
  note           text not null default '',
  verified       boolean not null default false,
  verified_at    timestamptz,
  verified_email text,
  updated_at     timestamptz not null default now(),
  primary key (project_id, floor, room_no, kind, code)
);

do $$
declare t text;
begin
  foreach t in array array['byroom_mark_edits','byroom_room_marks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
