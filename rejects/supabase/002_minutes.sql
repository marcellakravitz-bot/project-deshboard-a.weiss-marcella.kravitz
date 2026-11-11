-- =============================================================================
--  סיכומי פגישה / ריג'קטים — 11.11.2026 · rejects build 14
--  The minutes of a list: who was there, a line per party, and a general
--  summary — { "people": [{ "g": "א. וייס", "n": "מאור אליהו, מרסלה קרביץ" }],
--  "summary": "…" }. The old one-line "attendees" column stays, and is kept
--  filled from the lines, for the subcontractor app. Safe to run more than once.
-- =============================================================================
alter table public.rejects_lists add column if not exists minutes jsonb not null default '{}'::jsonb;
