-- 07.11.26 — the apps' server (sub-portal) reads and writes the task boards
-- with the service role. The table was created with rights for signed-in
-- users only, so the server's reads came back empty: every task looked
-- "טרם בוצע" in the project managers' app, and nothing written there was kept.
grant select, insert, update, delete on table public.project_tasks to service_role;
-- The same for the list of projects given to a dashboard team user, which
-- the preview reads to know which projects to offer.
grant select on table public.project_access to service_role;
