-- =============================================================================
-- Dovis dashboard — optional seed data
-- =============================================================================
--
-- Run AFTER schema.sql. Entirely optional: it exists so a fresh install shows a
-- populated dashboard on the first sign-in instead of an empty page, which makes
-- it obvious whether reads, RLS and Realtime are actually working.
--
-- Delete these rows once the agent starts producing real ones — or use the
-- Danger Zone's "Delete the entire queue", which is exactly what it is for.
--
-- The demo deployment does NOT use this file. It runs on fixtures in
-- src/lib/demo-data.ts with no database at all.
-- =============================================================================

-- Widgets ---------------------------------------------------------------------
insert into public.dashboard_widgets (widget_type, title, config, position) values
  ('metric', 'Waiting on you',
   '{"kind":"metric","value":"2","caption":"of 14 handled since 06:00"}'::jsonb, 0),
  ('metric', 'Handled without you',
   '{"kind":"metric","value":"12","caption":"filed, ignored, or answered"}'::jsonb, 1),
  ('list', 'People waiting on a reply',
   '{"kind":"list","items":[{"label":"Example contact","meta":"1 day"}]}'::jsonb, 2),
  ('checklist', 'Today',
   '{"kind":"checklist","items":[{"label":"Set up Dovis","done":true},{"label":"Connect Gmail","done":false}]}'::jsonb, 3);

-- Queue -----------------------------------------------------------------------
-- Two items: one draft_email so the executor path is exercised, and one manual.
--
-- Testing with ONLY a manual item is the trap the build guide calls out: manual
-- items stamp `done` without doing anything, so they pass even when the executor
-- cannot act at all.

with e as (
  insert into public.todos (title, action_type, status, priority, source)
  values ('Reply to the example contact about scheduling',
          'draft_email', 'proposed', 'normal', 'email')
  returning id
)
insert into public.todo_payloads (todo_id, payload_proposed, payload_current)
select id,
  '{"to":"contact@example.com","subject":"Re: Scheduling","body":"Thursday afternoon works. I will send an invite.\n\nBest,"}'::jsonb,
  '{"to":"contact@example.com","subject":"Re: Scheduling","body":"Thursday afternoon works. I will send an invite.\n\nBest,"}'::jsonb
from e;

with m as (
  insert into public.todos (title, action_type, status, priority, source)
  values ('Sign the document that arrived this morning',
          'manual', 'proposed', 'high', 'email')
  returning id
)
insert into public.todo_payloads (todo_id, payload_proposed, payload_current)
select id,
  '{"detail":"Needs a physical signature. Dovis cannot do this one."}'::jsonb,
  '{"detail":"Needs a physical signature. Dovis cannot do this one."}'::jsonb
from m;
