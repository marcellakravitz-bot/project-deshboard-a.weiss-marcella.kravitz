-- =============================================================================
--  Dashboard team users (role "team") — 06.11.2026, site build 258
--
--  A team user works on the dashboard like the administrator, but only on the
--  projects given to them (project_access), and never in the system menu.
--  Every rule below is "team AND can_touch_project(<the row's project>)", so
--  the server, not the screen, keeps them inside their projects.
--  Nothing the administrator has is narrowed. Safe to run more than once.
-- =============================================================================

create or replace function public.is_team()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'team', false);
$$;

-- app_state: a team user writes the rows of their own projects (the Marcella
-- board stays the administrator's), and the shared catalogue of contacts and
-- categories, which the boards add to as they are filled.
create or replace function public.app_state_may_write(k text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select
    public.is_admin()
    or (
      public.app_state_pid(k) is not null
      and k not like 'project-marcella:%'
      and (auth.jwt() -> 'app_metadata' ->> 'role') = 'contractor'
      and public.can_touch_project(public.app_state_pid(k))
    )
    or (
      public.app_state_pid(k) is not null
      and k not like 'project-marcella:%'
      and public.is_team()
      and public.can_touch_project(public.app_state_pid(k))
    )
    or (k = 'contacts-catalog' and public.is_team())
    or (
      k like 'project-sd-approvals:%'
      and public.app_state_pid(k) is not null
      and public.can_touch_project(public.app_state_pid(k))
    )
    or (
      k like 'project-submittal-approvals:%'
      and public.app_state_pid(k) is not null
      and public.can_touch_project(public.app_state_pid(k))
    );
$function$;

-- Everybody signed in reads the paper's settings (logo, footer) the prints use.
drop policy if exists "app_state read own projects" on public.app_state;
create policy "app_state read own projects" on public.app_state for select to authenticated using (
  ((app_state_pid(key) is not null)
    and (select can_touch_project(app_state_pid(app_state.key)))
    and ((key !~~ 'project-marcella:%') or (select marcella_may_read())))
  or (key = any (array['system-state', 'contacts-catalog', 'user-signatures', 'user-perms', 'print-settings']))
);

-- The modules' own tables, per project.
drop policy if exists facility_files_team on public.facility_files;
create policy facility_files_team on public.facility_files for all to authenticated
  using (public.is_team() and public.can_touch_project(project_id))
  with check (public.is_team() and public.can_touch_project(project_id));

drop policy if exists project_tasks_team on public.project_tasks;
create policy project_tasks_team on public.project_tasks for all to authenticated
  using (public.is_team() and public.can_touch_project(project_id))
  with check (public.is_team() and public.can_touch_project(project_id));

drop policy if exists rejects_lists_team on public.rejects_lists;
create policy rejects_lists_team on public.rejects_lists for all to authenticated
  using (public.is_team() and public.can_touch_project(project_id))
  with check (public.is_team() and public.can_touch_project(project_id));

-- The shared libraries.
drop policy if exists supplier_library_team on public.supplier_library;
create policy supplier_library_team on public.supplier_library for all to authenticated
  using (public.is_team()) with check (public.is_team());

drop policy if exists image_library_team_edit on public.image_library;
create policy image_library_team_edit on public.image_library for update to authenticated
  using (public.is_team() and public.can_touch_project(project_id))
  with check (public.is_team() and public.can_touch_project(project_id));
drop policy if exists image_library_team_drop on public.image_library;
create policy image_library_team_drop on public.image_library for delete to authenticated
  using (public.is_team() and public.can_touch_project(project_id));

-- The suppliers' files live under library/ in the submittals bucket.
drop policy if exists "submittals library team" on storage.objects;
create policy "submittals library team" on storage.objects for all to authenticated
  using (bucket_id = 'submittals' and (storage.foldername(name))[1] = 'library' and public.is_team())
  with check (bucket_id = 'submittals' and (storage.foldername(name))[1] = 'library' and public.is_team());

-- profiles.role accepts "team" too.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array['admin','contractor','client','team']));
