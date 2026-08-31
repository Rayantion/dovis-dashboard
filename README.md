# Dovis Dashboard

The web surface for **Dovis** — an executive assistant built on Hermes Agent, one
instance per principal. *Dovis is DOnna plus jarVIS*: Donna decides what is worth
doing, Jarvis does it properly, and the confirm gate is the line between them.

This dashboard is the confirm gate.

---

## What it is

A briefing, not an admin panel. The principal opens it, sees what Dovis proposes
to do, and confirms, modifies or rejects. Nothing executes without that.

- **`todos` is an action queue** — things Dovis proposes, not a to-do list for the
  boss.
- **Confirming a `draft_email` item produces a Gmail *draft*.** Not a sent mail.
  No tool on the agent box can send: `gmail_reply` is off the allowlist and
  `GMAIL_ALLOW_SENDING` is unset. The principal presses send. That one extra tap
  is the entire security posture.
- **Draft bodies never reach the browser through the database.** They live in
  `todo_payloads`, which has RLS on and no client policy, and is deliberately
  absent from the realtime publication.

---

## Run it in 30 seconds

```bash
npm install
npm run dev
```

With no `.env.local`, it starts in **demo mode**: a complete dashboard on
fixtures, no network, no database. Sign in as `owner / demo` or
`assistant / demo` to see both permission levels. Nothing is saved; reload resets.

This is also how the public showcase deployment runs.

---

## Deploying for a real principal

One box, one vault, one Supabase project, one Telegram bot, one Google account
per principal. The Hermes dashboard has no multi-user isolation, so instances are
not shared.

### 1. Supabase (hosted / cloud)

Create a project, then in the SQL Editor run, in order:

1. `supabase/schema.sql` — tables, accounts, RLS, realtime. Required.
2. `supabase/seed.sql` — a few example rows so the first sign-in isn't an empty
   page. Optional.

Then create the owner: **Authentication → Users → Add user**, copy the UUID, and
run the `insert into public.profiles` statement at the bottom of `schema.sql`.
The owner is the only account made by hand — everyone else is added from the Team
page.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in all three values. `SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_`
prefix and must never get one — it bypasses RLS entirely.

### 2b. Connecting Google (optional, but much nicer than the CLI)

Set the `GOOGLE_*` values in `.env.local` and a **Google account** card appears on the
Team page. The principal clicks **Connect Google**, approves at Google, and the
callback writes `.gauth.json`, `.accounts.json` and the token file into the directory
the MCP server reads.

The credentials land on **this machine**, not in the database and not over a network —
which is only possible because the dashboard and the agent are the same box. That is
the whole reason this is worth doing rather than something to be nervous about.

Three things decide whether it works:

1. **The OAuth client must be type "Web application"**, not Desktop, with the redirect
   URI matching `GOOGLE_REDIRECT_URI` exactly.
2. **Set the user type to Internal** if the principal has Google Workspace. External +
   Testing issues a refresh token that expires after 7 days for Gmail scopes, so Dovis
   stops reading mail weekly and it looks like a broken cron.
3. **`GOOGLE_TOKEN_FILE_PATTERN` must match what the MCP server looks for.** This is
   the one value worth verifying rather than trusting: run the server's own CLI auth
   once, `ls -a` the credentials directory, and copy the filename it produced. A wrong
   value fails in the worst way — OAuth succeeds, the card says Connected, and the
   agent still cannot read mail. The card checks for the token file specifically and
   warns when it authorised but found nothing on disk.

Scopes requested are `gmail.modify`, `calendar` and `userinfo.email` — the smallest set
that still allows drafting. Gmail has **no draft-only scope** (`gmail.compose` and
`gmail.modify` both permit sending at the API level), so "Dovis cannot send" is enforced
where it always was: `gmail_reply` off the tool allowlist, `GMAIL_ALLOW_SENDING` unset.
Do not add `gmail.send`.

### 3. Build and run on the box

```bash
NODE_OPTIONS=--max-old-space-size=1536 npm run build
npm run start          # binds 127.0.0.1:3000
```

**Never run `npm run dev` on the box.** Dev mode costs ~600MB resident and
recompiles forever.

### 4. Expose it

The dashboard binds loopback. Put a Cloudflare Tunnel in front of it and point it
at your domain. Use Cloudflare Access on the hostname as a second gate — the
app's own login is the first.

---

## Running on a small VPS

Fits comfortably on **4GB RAM / 2 vCPU** alongside Hermes, the gateway, the vault
and cloudflared. Figures below are estimates, not measurements from your box.

| Component | Approx. resident |
|---|---|
| Ubuntu 24.04 headless | ~300MB |
| Hermes + gateway | ~250MB |
| This dashboard (`npm run start`) | ~200MB |
| cloudflared | ~40MB |
| FTS5 RAG | ~100MB |

Three conditions:

1. **Add 2–4GB of swap before the first build.** `next build` peaks around
   1.5–2.5GB. That peak, landing while a cron agent turn is running, is the OOM
   window.
2. **Cap the build heap:** `NODE_OPTIONS=--max-old-space-size=1536`.
3. **Production mode only.** See above.

Supabase is hosted, which is what makes 4GB workable — self-hosting Postgres here
would not be.

The one change that breaks this: adding a **local embedding model** for RAG.
That is 0.5–1.5GB resident and will not coexist with an agent turn on 4GB.
Keyword search (FTS5) is fine.

---

## Accounts and permissions

Two roles, and one switch between them.

| | Owner | Assistant | Assistant with **Allow modify** |
|---|:---:|:---:|:---:|
| See the briefing and queue | ✅ | ✅ | ✅ |
| Open a draft and read it | ✅ | ✅ | ✅ |
| Confirm / modify / reject | ✅ | ❌ | ✅ |
| Delete anything | ✅ | ❌ | ❌ |
| Manage accounts | ✅ | ❌ | ❌ |

- The owner adds an assistant with an email and a username. The system issues a
  **temporary password**, shown once.
- The assistant signs in with **either** username or email, and is sent straight
  to `/set-password` — a temporary password can reach no other page.
- The owner can **pause** an account (login blocked, history kept) or **remove**
  it (irreversible).
- **Allow modify** is confirmed behind a warning, because confirming an email item
  writes a draft into the *owner's* Gmail under the owner's name.
- **Deletion is owner-only, unconditionally.** `can_modify` never widens it — in
  the UI, in the API routes, and in the RLS policies independently.

---

## A deliberate difference from the build guide

`dovis-build.md` §7 specifies:

```sql
CREATE POLICY "anon reads todos" ON todos FOR SELECT TO anon USING (true);
```

**This repo does not do that.** `schema.sql` grants read `TO authenticated`
instead.

The guide's version was correct for what it described — a dashboard bound to
loopback, reachable only from the box. This dashboard is reachable over a tunnel,
and `todos.title` is derived from the principal's email. Anon read would mean
anyone holding the publishable key could read the queue without signing in.

Realtime still works: `supabase-js` sends the user's JWT on the socket, so the
`TO authenticated` policy resolves for a signed-in session. The guide's suggested
fallback — dropping anon read and polling — is not needed.

---

## Verifying an install

Treat a failure here as a hard stop.

```bash
# Drafted email bodies must be unreachable. Rows coming back = stop.
curl -s "$SUPABASE_URL/rest/v1/todo_payloads?select=todo_id" \
     -H "apikey: $SUPABASE_ANON_KEY"

# With this schema, the queue is ALSO unreachable without a session.
curl -s "$SUPABASE_URL/rest/v1/todos?select=id,title" \
     -H "apikey: $SUPABASE_ANON_KEY"
```

Both should return a permission error or `[]`. Sign in through the dashboard to
see rows. If the queue returns rows to the bare anon key, the `anon reads todos`
policy from the old guide is still present — drop it.

---

## Adding to it

See **[docs/ADDING-FEATURES.md](docs/ADDING-FEATURES.md)** — adding a widget
(no deploy), adding an action type (deploy + a real tool), adding a page, and
adding a language.

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui ·
Supabase (auth, Postgres, Realtime).

Design tokens come from a Stitch design system, "Dovis Executive", translated into
CSS variables in `src/app/globals.css`. Two typefaces: Source Serif 4 for
headings, IBM Plex Sans for body. Traditional Chinese loads no webfont and falls
through to the system face.
