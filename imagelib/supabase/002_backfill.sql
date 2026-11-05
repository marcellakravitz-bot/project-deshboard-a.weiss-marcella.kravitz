-- One-time: put every picture already on the site into image_library.
-- Run once after 001. Safe to run again (the same picture is kept once).
with names as (
  select p->>'id' id, coalesce(p->>'name','') name
  from app_state, jsonb_array_elements(value::jsonb) c, jsonb_array_elements(coalesce(c->'projects','[]')) p
  where key = 'system-state'
),
lli as (   -- LLI rows: project-lli:<pid> → { code: { image, typeMark, desc } }
  select split_part(a.key, ':', 2) pid, r.key code, r.value v
  from app_state a, jsonb_each(a.value::jsonb) r
  where a.key like 'project-lli:%' and jsonb_typeof(r.value) = 'object'
  union all  -- the older single document: project-lli → { pid: { code: {...} } }
  select pj.key, r.key, r.value
  from app_state a, jsonb_each(a.value::jsonb) pj, jsonb_each(case when jsonb_typeof(pj.value)='object' then pj.value else '{}' end) r
  where a.key = 'project-lli' and jsonb_typeof(r.value) = 'object'
),
subs as (  -- submittals: project-extras:<pid> → { submittals: [ { image: { thumb } } ] }
  select split_part(a.key, ':', 2) pid, s
  from app_state a, jsonb_array_elements(coalesce(a.value::jsonb->'submittals', '[]')) s
  where a.key like 'project-extras:%'
),
rooms as ( -- room marks: project-rooms:<pid> → { marks: { key: { image, name } } }
  select split_part(a.key, ':', 2) pid, m.key mk, m.value v
  from app_state a, jsonb_each(coalesce(a.value::jsonb->'marks', '{}')) m
  where a.key like 'project-rooms:%' and jsonb_typeof(m.value) = 'object'
),
rej as (   -- rejects photos (the thumbnail kept on the row)
  select l.project_id pid, l.name ln, r, ph
  from rejects_lists l, jsonb_array_elements(coalesce(l.rows, '[]')) r,
       jsonb_array_elements(coalesce(r->'photos', '[]') || coalesce(r->'plans', '[]')) ph
),
src as (
  select pid, 'lli' source, concat_ws(' · ', nullif(v->>'typeMark',''), nullif(split_part(coalesce(v->>'desc',''), E'\n', 1),''), case when coalesce(v->>'typeMark','')='' and coalesce(v->>'desc','')='' then code end) label, v->>'image' data from lli
  union all
  select pid, 'submittal', concat_ws(' · ', nullif(s->>'typeId',''), nullif(s->>'itemDescription',''), nullif(s->>'modelCode','')), s->'image'->>'thumb' from subs
  union all
  select pid, 'rooms', concat_ws(' · ', split_part(mk, '|', 2), nullif(v->>'name','')), v->>'image' from rooms
  union all
  select pid, 'rejects', concat_ws(' · ', nullif(ln,''), nullif(r->>'floor',''), nullif(split_part(coalesce(r->>'desc',''), E'\n', 1),'')), ph->>'thumb' from rej
)
insert into public.image_library (project_id, project_name, source, label, data, created_by)
select distinct on (md5(src.data)) src.pid, coalesce(n.name, ''), src.source, left(coalesce(src.label, ''), 300), src.data, 'backfill'
from src left join names n on n.id = src.pid
where src.data like 'data:image/%' and src.pid <> ''
order by md5(src.data), src.source
on conflict (hash) do nothing;
