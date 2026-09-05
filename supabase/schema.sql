-- =============================================================================
-- Dovis dashboard — complete schema
-- =============================================================================
--
-- Run this ONCE against a fresh Supabase project (SQL Editor → paste → Run).
-- Nothing in the application hardcodes any of this; the app reads what is here.
--
-- Target: Supabase Cloud (hosted). Not tested against self-hosted Postgres.
--
-- ORDER MATTERS. Sections build on each other:
--   1. Tables        — the action queue and its payloads
--   2. Accounts      — owner / assistant, and what an assistant may do
--   3. Helpers       — SECURITY DEFINER role lookups (avoids RLS recursion)
--   4. RLS           — who may read and write what
--   5. Realtime      — without this the checklist never updates
--   6. Bootstrap     — promoting the first user to owner
--
-- THE ONE RULE THAT MUST NOT BE BROKEN:
--   `todo_payloads` holds drafted email bodies. It has RLS enabled and NO client
--   policy, and it is deliberately absent from the realtime publication. Adding
--   either would push draft contents to every browser holding the anon key.
-- =============================================================================


-- =============================================================================
-- 1. TABLES — the action queue
-- =============================================================================

-- The queue. Display fields only, safe for an authenticated browser to read,
-- which is what lets Realtime drive the checklist.
create table if not exists public.todos (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  action_type   text not null
                check (action_type in ('draft_email','manual')),
  status        text not null default 'proposed'
                check (status in ('proposed','modifying','confirmed',
                                  'executing','done','rejected','failed')),
  priority      text default 'normal'
                check (priority in ('low','normal','high')),
  source        text,
  created_at    timestamptz default now(),
  confirmed_at  timestamptz,
  completed_at  timestamptz
);

comment on column public.todos.action_type is
  'Enforced by CHECK, not by convention. There is deliberately no send_email: '
  'gmail_reply is excluded from the agent tool allowlist and GMAIL_ALLOW_SENDING '
  'is unset, so no tool on the box can send mail. Widening this enum requires a '
  'new tool behind it.';

comment on column public.todos.status is
  'executing is a CLAIM the executor sets BEFORE acting, so two overlapping cron '
  'runs cannot double-execute one row. A row still in executing long after a run '
  'finished is a crashed execution, and is visible precisely because it is real.';

-- The contents. NEVER browser-readable. Reached only through a server route
-- holding the service_role key, after a session check.
create table if not exists public.todo_payloads (
  todo_id           uuid primary key references public.todos(id) on delete cascade,
  payload_proposed  jsonb not null,
  payload_current   jsonb not null,
  modify_note       text,
  reject_reason     text
);

comment on column public.todo_payloads.payload_proposed is
  'What Dovis first proposed. NEVER overwritten. The difference between this and '
  'payload_current is a labelled correction, produced free every time the principal '
  'edits before confirming. It is what makes the system learn.';

-- Widgets are DATA, not code. To add one, insert a row. Never generate a bundle.
create table if not exists public.dashboard_widgets (
  id           uuid primary key default gen_random_uuid(),
  widget_type  text not null
               check (widget_type in ('metric','chart','list','checklist','approval')),
  title        text not null,
  config       jsonb,
  position     int default 0
);


-- =============================================================================
-- 2. ACCOUNTS — owner and assistant
-- =============================================================================
--
-- One owner (the principal). Zero or more assistants.
--
-- An assistant is READ-ONLY by default. The owner may tick `can_modify` to let
-- them confirm / modify / reject queue items. That is the only permission the
-- owner can grant. Deletion is owner-only in every code path and in RLS, and
-- `can_modify` never widens it.

create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text not null unique,
  username              text not null unique
                        check (username ~ '^[a-z0-9_.-]{3,32}$'),
  display_name          text,
  role                  text not null default 'admin'
                        check (role in ('owner','admin')),
  status                text not null default 'active'
                        check (status in ('active','paused')),
  can_modify            boolean not null default false,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  last_sign_in_at       timestamptz,
  -- NULL means "not initialised": the account has never told the server which
  -- language it reads in. The browser seeds it once from its own toggle, after
  -- which this row is the source of truth and the language follows the person
  -- between devices instead of living in one browser's localStorage.
  lang                  text check (lang in ('en','zh-TW'))
);

/*
  For databases created before `lang` existed. `create table if not exists`
  above is a no-op on them, so the column has to arrive separately, and this
  file is re-run as a whole rather than as a migration chain.
*/
alter table public.profiles
  add column if not exists lang text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_lang_check'
  ) then
    alter table public.profiles
      add constraint profiles_lang_check check (lang in ('en','zh-TW'));
  end if;
end
$$;

comment on column public.profiles.can_modify is
  'Owner-granted. Lets an assistant confirm, modify and reject. Confirming a '
  'draft_email item writes a draft into the OWNER''S Gmail under the owner''s name, '
  'which is why the UI shows a warning before this is switched on.';

comment on column public.profiles.status is
  'paused blocks sign-in but keeps the account and its history. Pausing is '
  'reversible; removing is not.';

-- Usernames are compared lower-case. Store them lower-case so the unique index
-- means what it appears to mean.
create or replace function public.lowercase_username()
returns trigger
language plpgsql
as $$
begin
  new.username := lower(new.username);
  new.email := lower(new.email);
  return new;
end;
$$;

drop trigger if exists profiles_lowercase on public.profiles;
create trigger profiles_lowercase
  before insert or update on public.profiles
  for each row execute function public.lowercase_username();


-- =============================================================================
-- 3. HELPERS
-- =============================================================================
--
-- SECURITY DEFINER so they bypass RLS. Without this, a policy ON profiles that
-- reads profiles recurses infinitely and every query fails with a stack error.

create or replace function public.dovis_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
   where id = auth.uid() and status = 'active'
$$;

create or replace function public.dovis_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'owner' from public.profiles
      where id = auth.uid() and status = 'active'),
    false)
$$;

-- Owner always. Assistant only if the owner ticked the box. Paused accounts never.
create or replace function public.dovis_can_modify()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (role = 'owner' or can_modify) from public.profiles
      where id = auth.uid() and status = 'active'),
    false)
$$;

-- A paused account holds a valid JWT until it expires, so every read policy
-- checks status rather than trusting the token alone.
create or replace function public.dovis_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status = 'active' from public.profiles where id = auth.uid()),
    false)
$$;


-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

alter table public.todos             enable row level security;
alter table public.todo_payloads     enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.profiles          enable row level security;

-- -----------------------------------------------------------------------------
-- todo_payloads: NO POLICY, ON PURPOSE.
-- -----------------------------------------------------------------------------
-- RLS enabled plus no matching policy = deny. service_role has BYPASSRLS and
-- needs no policy, so writing one would be inert. Drafted email bodies therefore
-- have exactly one route to a browser: a server handler that checked the session
-- first. Do not "fix" this by adding a policy.

-- -----------------------------------------------------------------------------
-- todos
-- -----------------------------------------------------------------------------
drop policy if exists "anon reads todos"      on public.todos;
drop policy if exists "read todos"            on public.todos;
drop policy if exists "act on todos"          on public.todos;
drop policy if exists "owner deletes todos"   on public.todos;

-- NOTE: this is deliberately TO authenticated, not TO anon.
-- The upstream build guide used `anon ... USING (true)` because the dashboard
-- was specified to bind loopback. This deployment is reachable over a tunnel, so
-- anon read would expose the queue to anyone holding the publishable key —
-- and titles are derived from the principal's email. Realtime still works,
-- because supabase-js sends the user's JWT on the socket.
create policy "read todos" on public.todos
  for select to authenticated
  using (public.dovis_is_active());

-- Confirm / modify / reject. Owner always; assistant only with can_modify.
create policy "act on todos" on public.todos
  for update to authenticated
  using (public.dovis_can_modify())
  with check (public.dovis_can_modify());

-- Deletion is owner-only, unconditionally.
create policy "owner deletes todos" on public.todos
  for delete to authenticated
  using (public.dovis_is_owner());

-- -----------------------------------------------------------------------------
-- dashboard_widgets
-- -----------------------------------------------------------------------------
drop policy if exists "anon reads widgets"    on public.dashboard_widgets;
drop policy if exists "read widgets"          on public.dashboard_widgets;
drop policy if exists "owner writes widgets"  on public.dashboard_widgets;
drop policy if exists "owner updates widgets" on public.dashboard_widgets;
drop policy if exists "owner deletes widgets" on public.dashboard_widgets;

create policy "read widgets" on public.dashboard_widgets
  for select to authenticated
  using (public.dovis_is_active());

-- INSERT policies take WITH CHECK, never USING. Postgres rejects USING on INSERT
-- outright and aborts the whole migration.
create policy "owner writes widgets" on public.dashboard_widgets
  for insert to authenticated
  with check (public.dovis_is_owner());

create policy "owner updates widgets" on public.dashboard_widgets
  for update to authenticated
  using (public.dovis_is_owner())
  with check (public.dovis_is_owner());

create policy "owner deletes widgets" on public.dashboard_widgets
  for delete to authenticated
  using (public.dovis_is_owner());

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "owner reads all"    on public.profiles;
drop policy if exists "owner manages"      on public.profiles;
drop policy if exists "owner updates"      on public.profiles;
drop policy if exists "owner deletes"      on public.profiles;

create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "owner reads all" on public.profiles
  for select to authenticated
  using (public.dovis_is_owner());

create policy "owner updates" on public.profiles
  for update to authenticated
  using (public.dovis_is_owner())
  with check (public.dovis_is_owner());

create policy "owner deletes" on public.profiles
  for delete to authenticated
  using (public.dovis_is_owner() and id <> auth.uid());

-- Account creation goes through the server route with service_role, because it
-- must create an auth.users row and a profile together. There is no client
-- INSERT policy, so a browser cannot mint an account under any circumstances.


-- =============================================================================
-- 5. REALTIME
-- =============================================================================
--
-- RLS alone does not make a table stream. The table must join the publication,
-- and REPLICA IDENTITY FULL is required for UPDATE events — which is exactly what
-- the checklist watches, since confirming an item IS a status update.
--
-- Without this the dashboard connects, subscribes successfully, and simply never
-- receives an event. It looks like a frontend bug and is a database setting.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'todos'
  ) then
    alter publication supabase_realtime add table public.todos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'dashboard_widgets'
  ) then
    alter publication supabase_realtime add table public.dashboard_widgets;
  end if;
end
$$;

alter table public.todos             replica identity full;
alter table public.dashboard_widgets replica identity full;

-- todo_payloads is NOT added here, and must never be. Streaming it would push
-- drafted email bodies to every subscribed browser.


-- =============================================================================
-- 6. BOOTSTRAP — creating the owner
-- =============================================================================
--
-- 1. Authentication → Users → "Add user" in the Supabase dashboard. Use the
--    principal's email and a password you give them directly.
-- 2. Copy the new user's UUID.
-- 3. Run the insert below with that UUID.
--
-- Everyone after this is created from the Team page in the dashboard; the owner
-- is the only account that has to be made by hand, because there is nobody to
-- authorise it yet.
--
--   insert into public.profiles
--     (id, email, username, display_name, role, status, can_modify, must_change_password)
--   values
--     ('00000000-0000-0000-0000-000000000000',  -- <- the UUID from step 2
--      'boss@example.com',
--      'boss',
--      'Boss Name',
--      'owner',
--      'active',
--      true,
--      true);   -- true forces a password change on first sign-in. Recommended.
--
-- VERIFY, and treat a failure here as a hard stop:
--
--   -- Must return a permission error or an empty array. Rows coming back mean
--   -- drafted email bodies are readable by anyone holding the publishable key.
--   curl -s "$SUPABASE_URL/rest/v1/todo_payloads?select=todo_id" \
--        -H "apikey: $SUPABASE_ANON_KEY"
--
--   -- Must ALSO be empty now: reads require a signed-in session, not anon.
--   curl -s "$SUPABASE_URL/rest/v1/todos?select=id,title" \
--        -H "apikey: $SUPABASE_ANON_KEY"
--
-- Both empty is correct for this schema. Sign in through the dashboard to see rows.
