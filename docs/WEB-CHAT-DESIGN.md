# Web chat — design

**Status: designed, not built.** Approved 2026-09-03. This supersedes the "Web
assistant" section of `ADDING-FEATURES.md`, which recorded the decision to call
the Hermes gateway but left the transport unresolved.

---

## What changed: the blocker is retired, not answered

`ADDING-FEATURES.md` blocked this feature on one unverified fact — *does Hermes
expose an HTTP chat endpoint with resumable session IDs?* Shared memory between
web and Telegram depended on it.

That question no longer needs an answer, because the design no longer asks Hermes
to remember anything between calls. **The database holds the conversation and
replays it.** Hermes receives the history it needs on every request and can be
restarted, redeployed or rebooted mid-conversation without losing the thread.

This is the same reasoning as the refresh work shipped alongside it: make the
durable store the source of truth, and treat every process holding state in
memory as an optimisation you are allowed to lose.

## Data flow

```
Browser  ──POST──▶  /api/chat  ──POST──▶  Hermes webhook on the box
                    (session +            (secret header, never
                     role check)           reaches the browser)
                                                   │
                                                   ▼
Browser  ◀──Realtime──  messages table  ◀──insert──┘
```

1. The user types. The browser POSTs to `/api/chat` — same origin, no secret.
2. The route authenticates the Supabase session, checks the role, writes the
   user's turn to `messages`, and forwards to Hermes with the last N turns.
3. Hermes answers on the box, with its own vault and memory, and inserts the
   reply into `messages` (service_role, via the same route or a callback).
4. The browser receives the reply over the Realtime channel already subscribed
   for the queue. No polling, no streaming, no long-lived connection.

Because replies arrive by Realtime, they inherit the same delivery caveat as the
queue: a reply that lands while the socket is down will not arrive on its own.
The chat view therefore refetches its thread on mount and on reconnect, using the
same pattern as `refresh()` in `dovis-provider.tsx`.

**Confirmed against the box, 2026-09-03:**

- **The webhook response is an acknowledgement, not the answer.** It says the run
  was accepted. The reply arrives later, through Supabase. Any implementation
  that awaits a chat response from that POST is wrong.
- **Authentication is HMAC**, natively: `X-Webhook-Signature-V2` and
  `X-Webhook-Timestamp`, with the timestamp inside roughly ±300 seconds, and a
  per-route secret. Rate limiting and idempotency are supported. Hermes offers no
  native mTLS or Cloudflare service-token auth; Cloudflare Access may sit in
  front as an outer layer but never replaces HMAC validation.
- **Hermes writes its reply directly to Supabase** using the service-role
  credential already held in its protected environment on the VPS. This settles
  the earlier open question: a callback into `/api/chat` also works but adds an
  authenticated hop for nothing, since Hermes is not the browser session that
  route authenticates.
- **`/api/chat` inserts the user's turn itself**, server-side, before forwarding.

## Security — the part that must not be ported from paddy

`paddy-detector` has a working chat (`src/lib/chat.ts`, `src/components/chat/`)
whose UI this design reuses. **Its transport must not be reused.** paddy calls a
public n8n webhook directly from the browser, gated by a string its own comment
correctly describes as *"NOT a secret... it filters junk traffic; it does not
authenticate."*

That trade is right for paddy, where the worst case is a bot asking about rice
leaves. It is wrong here for two reasons:

1. **The webhook drives an assistant with the principal's Gmail and calendar.**
   A URL in the client bundle is a URL anyone can drive.
2. **It would route around the permission model.** The assistant role is
   read-only by design — no modify without the owner's switch, no delete ever,
   enforced in the UI, the API routes and RLS. An assistant who can send free
   text to Hermes can simply *ask* for what the UI forbids, and `can_modify`
   stops meaning anything.

paddy could not fix this: it is a client-side PWA with no server. This dashboard
has API routes and already holds `service_role`, so it can. Hence:

- **No Hermes URL or secret in `NEXT_PUBLIC_*`.** Server-side env only.
- **`/api/chat` authenticates before forwarding**, exactly like `/api/act`.
- **The server picks the Hermes route from the authenticated role** — see below.
  A role in the request body is not an authority.

## Assistant chat — decided 2026-09-03

The deployment owner: *"Yes assistant can use the chat, but externally, so yeah they can't
modify anything."* Assistants get the chat. The constraint is that nothing they
say can cause Dovis to act.

**That has to be structural, not a prompt.** Dovis's existing guarantee about
sending mail is credible precisely because `gmail_reply` is absent from the tool
allowlist and `GMAIL_ALLOW_SENDING` is unset — the model cannot send because the
capability is not there, not because it was asked nicely. An assistant chat that
relied on "you are talking to an assistant, do not act" would be a promise a
sufficiently persuasive message can undo, which is the thing this architecture
rejects everywhere else.

**How, confirmed against the box 2026-09-03.** Hermes does *not* accept an
arbitrary toolset per request — an earlier draft of this document assumed it
did. It exposes **fixed toolsets per webhook route**. So the enforcement is one
route per role, each with its own secret, and `/api/chat` chooses between them
from the authenticated Supabase profile:

```yaml
routes:
  owner-chat:
    secret: "server-side-owner-secret"
    toolsets: [hermes-telegram]        # full core toolset, trusted path only
  assistant-chat:
    secret: "server-side-assistant-secret"
    toolsets: [hermes-webhook, no_mcp] # web search/extract/vision/clarify only
```

This is stronger than a per-request toolset would have been: the assistant route
cannot be talked into a capability it does not have, because the capability is
bound to a URL and a secret the browser never sees. An assistant's turn gets no
todo mutation, no `write_file`, no patch, no terminal or process tools, no memory
or skill management, no `gmail_create_draft` and no calendar writes.

**Never forward a client-supplied route name or role.** The route is derived
server-side from the session; a body field like `{"role":"assistant"}` is not
evidence of anything.

Within that, an assistant's chat is a **real conversation, not a restricted
query box** (the client: *"not only read only, they able to use it to ask some
things"*). They can ask Dovis for help the way the owner does. What they cannot
do is cause anything to happen.

**Separation and visibility, as specified:**

- An assistant's conversations are **their own**, in the same list UI.
- An assistant **cannot see the owner's conversations**, including the merged
  Telegram one. Enforced by the RLS above, not by hiding it in the UI.
- The **owner can see an assistant's conversations**, and they carry an
  **assistant tag** in the list naming who is talking.

**The assistant must be told they are visible.** The owner-can-read rule is a
reasonable arrangement between a principal and someone acting for them, and it
stops being reasonable the moment it is a surprise — an assistant who believes a
chat is private will eventually put something personal in it. A single persistent
line in the assistant's chat view ("Your conversations are visible to the
owner.") costs nothing and makes the arrangement honest rather than a trap.

**Still open: reading is not modification.** "Cannot modify" does not stop an
assistant from *asking Dovis what is in the owner's inbox* — that is a read, and
a no-writes tool set permits it. The queue already exposes some mail-derived
titles to assistants, but an answerable question about the mailbox is a
categorically wider door.

Recommendation is still to withhold mailbox and calendar **read** tools from an
assistant's turn. But note that owner-visible transcripts genuinely weaken the
argument against allowing them: an assistant fishing through the principal's mail
would be doing it in full view of the person whose mail it is, which is a real
deterrent and a real audit trail. Allowing reads is therefore a defensible
choice here in a way it would not be with private assistant chats. It remains a
decision to make rather than one to inherit.

## Conversation model — decided 2026-09-03

The deployment owner asked for "one thread", and for it to work "like Gemini web or app". Those
are the same requirement once stated precisely, and it is **not** one endless
transcript. Gemini keeps *many named conversations in a list, synced across every
device* — opening it on a phone or the web shows the same list, and any of them
can be continued. The system feels unified because the set of conversations is
shared, not because there is only one.

So:

- Conversations are first-class rows with a title, a pinned flag and timestamps.
- The web gets the full Gemini shape: list, auto-titled from the first message,
  pin, resume, new chat.
- **Telegram is one always-on conversation that appears in that list.** Opening
  it on the web continues the conversation from the phone. Telegram itself gains
  no commands — no `/new`, no `/switch`. Conversation management is a web
  affordance; Telegram stays a single linear chat, which is all it can be.

This retires the earlier "one thread or two" question, and with it the privacy
objection that motivated separate threads: per-owner RLS means an assistant
cannot see the owner's conversations at all, so merging leaks nothing. The leak
only ever existed if rows were deliberately shared across accounts.

**The cost lands on Hermes, not the dashboard.** For the Telegram conversation to
appear on the web, Hermes must persist every Telegram turn into `messages` as it
happens, rather than keeping it only in its own memory.

**Confirmed 2026-09-03: it does not do this today.** Hermes persists Telegram
sessions in its own local session database and transcripts, and writes nothing to
Supabase. So **the UI must not promise a Telegram conversation until that bridge
exists.** Ship the conversation list with web conversations only; the Telegram
row appears when Hermes can populate it, not before. Building the list so it
renders whatever `conversations` contains — rather than hard-coding a Telegram
entry — makes that a data change rather than a UI change.

The bridge, when it is built, must: find or create exactly one owner conversation
with `source = 'telegram'`; insert every inbound turn and every Dovis reply;
generate a title from the first exchange; keep delivering Telegram messages even
if the Supabase write fails, logging and retrying the missed persistence rather
than dropping the conversation; and attach the correct owner id so a message can
never land in another client's project.

That last point deserves weight: one box per boss means a mis-scoped owner id is
not a display bug, it is one principal's mail appearing in another's dashboard.

## Schema

```sql
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  title      text,
  source     text not null default 'web' check (source in ('web','telegram')),
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.conversations (author_id, pinned desc, updated_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  role            text not null check (role in ('user','dovis')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);
```

`author_id` is *who is talking*, not who the box belongs to. The earlier draft
called it `owner_id`, which was wrong once assistants got their own chats — there
is exactly one owner per deployment, so that column carried no information and
could not express the visibility rule below.

Exactly one conversation per owner carries `source = 'telegram'`. Hermes writes
into it and the web lists it alongside the rest. `title` is null until Hermes
generates one from the first exchange, the way Gemini does.

RLS from day one, not added later. A conversation belongs to one principal, and
an assistant account must never read the owner's thread — the whole point of the
queue is that the owner sees things the assistant does not.

Visibility is **asymmetric**, per the deployment owner 2026-09-03: an assistant sees only their
own conversations; the owner sees everyone's, theirs and every assistant's.

Use the helper the schema already has. `supabase/schema.sql:157` defines
`public.dovis_is_owner()` — `SECURITY DEFINER` so a policy does not recurse into
`profiles`' own RLS, `STABLE` so Postgres evaluates it once per statement rather
than once per row, which matters because these rows stream over Realtime. An
earlier draft of this document invented a second `is_owner()` beside it. That was
a mistake: two helpers with the same meaning are what drift apart across
migrations, and the cost of avoiding it is one word.

```sql
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

create policy "read own, owner reads all" on public.conversations
  for select to authenticated
  using (author_id = auth.uid() or public.dovis_is_owner());

create policy "read own, owner reads all" on public.messages
  for select to authenticated
  using (author_id = auth.uid() or public.dovis_is_owner());
```

Do **not** reach for `dovis_is_active()` here instead. It differs only by also
requiring `status = 'active'`, and the owner cannot be paused — `/api/team/update`
refuses it. But wrapping the whole clause in it would also stop a paused
assistant reading their own past conversations, which is their own data. If that
is wanted it is a separate decision, taken with that consequence named.

`author_id` is denormalised onto `messages` on purpose — the policy stays a
column comparison plus one cached function call, rather than a join back to
`conversations` on every streamed row.

The asymmetry holds in one direction only: an assistant cannot reach the owner's
conversations, the merged Telegram one included, while the owner can audit
anything an assistant asked Dovis.

**Assistants are also isolated from each other**, and that falls out of the same
clause rather than needing a rule of its own: for an assistant `is_owner()` is
false, so the only surviving rows are those where `author_id` is their own id.
One assistant cannot read another's conversations. This is worth stating
explicitly because it is the kind of guarantee usually implemented by filtering
in the UI, where it is not a guarantee at all — here the rows never leave
Postgres, so no query, no crafted request and no bug in the sidebar can expose
them.

Writes go through the server route under `service_role`, never from the browser —
the same shape `todo_payloads` already uses. `messages` **is** added to the
realtime publication (unlike `todo_payloads`), because the reply has to stream.
That is safe precisely because the select policy is owner-scoped.

## Context window

Stateless replay costs tokens as a thread grows. Cap it:

- Send the last **N turns** verbatim (start at 20, tune against real threads).
- Keep a rolling summary row for everything that fell out of the window.

Since Codex on the box authenticates with a ChatGPT subscription rather than
metered API credit, this is latency, not billing. It still bounds the prompt.

## UI

Ported from `paddy-detector`, which already solved most of this and was verified
on mobile and desktop:

| paddy | Dovis |
|---|---|
| `AssistantIcon.tsx` | Port as-is. One sparkle identity shared by every entry point so the bubble, the tab and any inline trigger read as one feature. Honours `prefers-reduced-motion`. |
| `ChatSheet.tsx` (725 lines) | **Split during the port** — it is near the 800-line ceiling before Dovis adds anything. |
| `ChatHistorySheet.tsx` | Port; back it with `messages` instead of IndexedDB. |
| `lib/chat.ts` | Rewrite. This is the transport, and the transport changes. |

Behaviour agreed with the deployment owner:

- A floating **bubble** on the dashboard, and a dedicated **Assistant page**.
- The bubble **hides on the Assistant page** and returns elsewhere — it should
  never offer a route to the page you are already on.
- A **conversation list**, Gemini-style: auto-titled from the first exchange,
  pinned items first, then most recently updated. The Telegram conversation
  appears in this list like any other and is labelled as such.
- **Pinning.**
- In the **owner's** list, conversations belonging to an assistant carry an
  **assistant tag** naming who is talking. An assistant's own list contains only
  their conversations and needs no tag.
- The assistant's chat view carries a persistent line stating that the owner can
  read it.
- **Mobile first.** Verify at 375 and 1440 before it is called done.

### The owner's sidebar

The owner's own conversations list flat. Assistants' conversations sit behind a
collapsed **Assistants folder** in the left rail, which expands to reveal them,
each tagged with who is talking.

- **Fetch on expand, not on page load.** The folder is collapsed by default, so
  an owner who never opens it never pays for the query. This matters more than
  any client-side throttling.
- **Five at a time**, with a *Show 5 more* control when more exist. Implemented
  as a keyset page over `(pinned desc, updated_at desc, id)` using Supabase
  `.range()` — not by fetching everything and slicing, which would defeat the
  point.
- **Debounce belongs on search, not on paging.** *Show 5 more* is a paged fetch
  — each click is one deliberate request, so there is nothing to debounce.
  Search is where the debounce belongs. See below.

If more than one assistant exists, consider sub-grouping the folder by assistant
rather than interleaving them — five conversations drawn from three people reads
as noise. Left as a refinement, not a requirement.

### Search

Clarified by the deployment owner 2026-09-03: the debounce is for **chat search** — finding
things they said in earlier conversations. So search runs over **message content**,
not only conversation titles; "what did I say about the insurance renewal" is the
actual question being asked.

Debounce the input at roughly 250ms, so typing `insurance` issues one query
rather than nine.

**RLS scopes the results for free.** The same select policy applies, so an
owner's search reaches their own conversations and their assistants'; an
assistant's reaches only their own. No separate filtering, and no way for a
mistake in the search UI to widen it.

**Native Postgres full-text search is the wrong tool here.** Supabase's own
documentation states that native Postgres FTS "is limited to alphabet and
digit-based languages" — `to_tsvector` does not segment Chinese, which has no
spaces, so a 繁中 message collapses to roughly one token and the search silently
fails to match anything sensible. This interface is bilingual EN / zh-TW, so that
is not an edge case.

Two workable options:

1. **`pg_trgm` with `ilike`** — a trigram GIN index on `content`. Handles
   substring matching in both scripts, is a standard extension, and is simple.
   **Start here.** The corpus is one principal and a few assistants; this is
   comfortably enough.
2. **PGroonga** — Supabase documents it as the multilingual full-text option and
   names Chinese and Japanese explicitly. The upgrade path if Chinese search
   quality ever becomes a real complaint, not something to reach for first.

```sql
create extension if not exists pg_trgm;
create index on public.messages using gin (content gin_trgm_ops);
```

The list is the piece paddy has no equivalent for — its `ChatHistorySheet` shows
turns within a single capture's thread, not a set of conversations. Expect to
write that one rather than port it.

Per the workspace rule, visual direction for this new surface goes through the
`stitch-to-shadcn` skill and Stitch MCP before components are written. Take the
tokens, not the markup; implementation comes from the shadcn registries.

## Out of scope, recorded so it is not re-litigated

- **STT / TTS runs through Hermes**, configured on the box (the deployment owner, 2026-09-03).
  Not a dashboard concern. Config shapes are now known rather than guessed:
  `stt.provider` with `groq` (`whisper-large-v3-turbo`) or `openai`
  (`whisper-1`, a separate paid credential), and `tts.provider: edge`. Hermes
  recommends **Groq Whisper plus Edge TTS** — Edge needs no key.
  **Live issue worth passing on:** the box currently has STT enabled with a
  **local `base` model**, on 4GB / 2 vCPU. That is the arrangement the budget
  cannot support, and it is running now rather than being a future risk.
- **A ChatGPT subscription grants no API access.** This has now blocked two
  designs (the chat model, then STT). Treat it as standing: anything needing a
  programmatic OpenAI call is a second bill and a second secret.
- **Default language is set by Hermes** (the deployment owner, 2026-09-03), not chosen in the
  dashboard. The existing EN / zh-TW toggle stays a per-viewer override.

## Open questions — answer before building

1. ~~Can an assistant use the chat at all?~~ **Answered 2026-09-03: yes, but
   externally — they cannot modify anything.** See "Assistant chat" below for
   what that has to mean in enforcement terms, and for the reading question it
   leaves open.
2. ~~One thread or two?~~ **Answered 2026-09-03: one shared conversation set,
   Gemini-style.** See the conversation model above.
3. ~~How does Hermes authenticate back to Supabase?~~ **Answered: service-role
   credential already held in its protected environment on the VPS, inserting
   directly.** A callback adds a hop for nothing.
4. ~~Can Hermes persist every Telegram turn?~~ **Answered: not today.** It keeps
   Telegram in its own local session store. The merged list therefore ships
   web-only until that bridge is built.
5. ~~Which repository is the deployment target?~~ **Answered: this one is
   upstream; Hermes replicates it into the private client repo.** See
   "Deployment targets" for what that means for verification.

## Deployment targets — two repos, and the trap in it

Discovered 2026-09-03 from Hermes' integration answers, then verified directly:

| Repo | Deployment | `/api/health` |
|---|---|---|
| `Rayantion/dovis-dashboard` (this one, public template) | `dovis-dashboard.vercel.app` | `demo:true, supabase:false` |
| a private per-client repo | that client's own deployment | `demo:false, supabase:true, serviceRole:true` |

**This repo is upstream.** Work lands here, and Hermes pulls it into the private
client repo and adapts it there (the deployment owner, 2026-09-03). So committing to the
template is correct, not a misfire — but it means a change is not *in service*
when it is pushed here. It is in service when Hermes has replicated it and
Vercel has redeployed the private project.

Two consequences worth holding on to:

1. **"Pushed" and "live for the boss" are different claims.** Verifying against
   `dovis-dashboard.vercel.app` proves only that the template built. The
   template runs in demo mode, where the realtime channel never connects — so a
   fix to realtime recovery cannot even execute there. Anything operational must
   be confirmed against the private deployment after Hermes has pulled.
2. **Replication is a step someone has to trigger.** Until it happens the
   upstream fix is doing nothing for the person who has the bug.

A check that distinguishes the two, worth running after any replication:

```bash
curl -s https://<the client deployment>/api/health
# demo:false is a live client instance. demo:true means you are looking at
# the template and have proved nothing about production.
```

Client repository names and hostnames are deliberately absent from this file. It
is public, it is cloned per client, and an install's own URLs belong in that
install — not in the template every other client also reads.

## Build order

1. Confirm whether an assistant's chat may read the principal's mailbox (see
   "Assistant chat"). The write answer is settled; this one is not, and it
   decides which tool set Hermes builds.
2. `conversations` + `messages` tables, RLS on both, `messages` added to the
   realtime publication.
3. `/api/chat` with session and role checks, and the Hermes secret server-side.
4. Stitch pass for the surface, then port the paddy components onto `messages`.
5. Verify: `npx tsc --noEmit`, `npm run build`, screenshots at 375 and 1440 in
   both languages, and an assistant account confirming it cannot read the
   owner's thread.

---

## Catch me up

**Status: designed, not built. Blocked on the chat above.** The deployment owner asked for this
2026-09-03 and settled every one of its twelve original open questions across
three rounds on 2026-09-05, the last of those rounds closing the two the earlier
rounds had left open. Those answers are folded into the body below rather than
left in a list at the foot; what remains at the foot is genuinely still open, and
it is two items rather than twelve — one of them a decision the final round
created rather than closed, because carrying it out honestly needs a column this
database does not have.

A quick action inside the chat, also fired by typing *"Catch me up"* or *"What
did I miss?"* — and by their Chinese equivalents, which is a requirement and not
a nicety; see the strings below. It summarises what changed since the boss last
actually looked: relevant mail, calendar changes and upcoming meetings, new and
changed queue items, decisions, unresolved conversations, anything urgent. It
states the period it covers — *"Since your last review — 5 September 2026,
09:20"* — and it is strictly read-only. It must not draft or send mail, create
calendar events, touch a todo, write a file, or cause anything else to happen
outside the box.

### It lives in the chat, and the chat is not built

There is no `/api/chat`, no `conversations` table and no `messages` table.
The recap is a turn in a conversation: the user's turn goes in, Hermes answers,
the answer arrives as a `messages` row over Realtime. Every one of those pieces
is upstream of this feature, so nothing here ships before build-order step 3
above. Hermes' own integration answers close on the same instruction — *"Do not
build the future items merely because they appear in the design document."*

That ordering is not a formality, but it is now the only thing outstanding. The
three hard problems this section spent most of its length on — which route the
run executes on, where the success signal comes from, and who writes it down —
are all decided as of 2026-09-05. The route is a dedicated read-only recap route,
which Hermes has confirmed is constructible. The mark is written by this server.
And the success signal is **defined by this side and validated by this side**,
which is the answer that changed the most and which the next three subsections
rebuild from the foundation up.

### The endpoint, and what a recap turn actually is

**The primary endpoint is `POST /api/recap`**, not `/api/chat` with a flag in the
body. Two reasons, and the second is the load-bearing one. A flag in the body is
a client-supplied route selector, which this design refuses everywhere else —
`{"role":"assistant"}` is not evidence of anything, and neither is
`{"recap":true}`. And `/api/recap` is the **only** door that opens a review
window. The marks that later close it are written by exactly one actor —
`POST /api/recap/seen`, on this side, under `service_role` — and never by
`/api/chat`, never by Hermes, never by the browser. Keeping the window-opening
behind one narrow door is worth more than the handful of lines the two routes
share.

What it does, in order: authenticate the session with `requireProfile()`; read
the caller's `last_seen_at`; find or create that caller's recap conversation;
resolve the timezone; decide which sources this run will **delegate** to the box;
insert the user's turn, carrying that decision on the turn's own `meta`; take the
window-open stamp from that inserted row; assemble the queue delta and the
caller's own unresolved threads; then forward to Hermes, naming the caller's
profile and the turn this run answers. The insert happens before the forward,
matching what `/api/chat` already has to do.

**Recording what was asked for, on the turn, is new and it is load-bearing.**
The confirmation route later has to decide whether the reply covered everything
this run was asked to cover, and that decision may happen minutes later in a
different process on a different page load. If the requested set were re-derived
at confirmation time from the caller's role, a role changed in between would
change the meaning of a run that already happened; if it were sent by the
browser, it would be a claim rather than a record. So the request is written down
by the side that made it, at the moment it made it, on a row nothing else can
edit. The confirmation route reads it back from Postgres under `service_role`.

If the queue or thread assembly fails, the route does **not** forward. It returns
a failure, the browser shows `recap.failed`, no reply is ever produced, and no
mark moves. The dashboard never asks the box to summarise a queue delta the
dashboard could not build.

It returns, to the browser: the window that turn opened, the IANA zone the run is
being rendered in, whether this was a first run, and the id of the turn itself.
**The window is what the browser holds**, for this run's header and nothing else.
The turn id is useful to it — a reply that names that turn is provably *this*
run's reply rather than a stale one — but **the turn id's durable job is not in
the browser at all.** It travels to Hermes with the request and comes back on the
reply, so that closing the window is a property of the rows rather than of the
tab that opened it. Why that distinction carries weight is worked out under the
confirmation route below.

**Which conversation it lands in.** A recap lands in **one reused conversation
per author**, marked `source = 'recap'`, exactly the shape the parent document
already uses for the single Telegram conversation. The two alternatives are both
bad: appending to whatever thread is open pollutes an unrelated conversation and
bumps its `updated_at` in the Gemini-style list, and opening a fresh conversation
each time gives the boss a sidebar of rows all auto-titled some variant of "Catch
me up". One reused row costs a widened check constraint in the chat migration —
`check (source in ('web','telegram','recap'))` — and an exemption in the
auto-titling rule, since this conversation's title is a fixed string rather than
something generated from the first exchange. In exchange the boss gets every
recap he has ever had in one scrollable place, which is the version of this
feature someone would actually ask for a month in.

**What the user turn's `content` is for a button click.** The visible label in
the viewer's language — `t.recap.quickAction`, "Catch me up" or 「補進度」. A
button click has no typed text, and that row is what the search index, the
replayed last-N turns and the boss re-reading the thread all see, so it has to
read like something a person wrote rather than an empty string or a marker like
`__recap__`. **Not `t.recap.triggers[0]`.** That list is normalised match input —
lower-cased and stripped of punctuation so the equality test below can be a plain
comparison — and its EN entry is the bare string `catch me up`, which written
into the transcript as the boss's own turn is the one lower-case sentence in a
product where every other English string is sentence-cased. zh-TW escapes it only
by coincidence, because 「補進度」 happens to be both. Normalising `quickAction`
yields exactly `catch me up` anyway, so the server-side re-match below sees the
same value either way.

**Trigger matching, and where it runs.** The client matches so it can render the
period header and the pending state, and posts to `/api/recap` instead of
`/api/chat` when it matches. **The server re-runs the same matcher** on the
submitted content before opening a window. That is not about capability — the
recap route is *narrower* than `owner-chat`, so getting it for an arbitrary
prompt is a downgrade rather than an escalation. It is about the marks. A POST to
`/api/recap` no longer moves anything by itself, but it stamps a user turn whose
timestamp is the value the confirmation route will later write as the new floor,
and whose `meta` is the record of what a reply will be checked against. A turn
that is not a recap request must not be allowed to mint either, or an ordinary
question answered on the recap route silently burns the boss's period when its
reply lands.

Normalise before comparing: trim, collapse internal whitespace, lower-case, and
strip trailing punctuation in both scripts (`.`, `?`, `!`, `。`, `？`, `！`). So
"What did I miss?" and "what did i miss" are one entry. **Compare for equality,
not containment.** A substring match fires on *"before you catch me up, tell me
what the Chen contract says"* and answers a different question on the recap route
with a period header attached to it, which is a lie about what the turn was.

A phrase the matcher misses falls through to `/api/chat` and is answered on the
ordinary route with wider tools. That is a miss toward a capability the principal
already has, so it is not an escalation — but the read-only guarantee and the
period header silently do not apply to that turn, and the marks do not move.
**The guarantee covers the button and the listed phrases. It does not cover every
sentence that means the same thing, and it must not be described as if it does.**

### The review marks, and why there are two of them

Three durable facts per authenticated user, on the row the owner already audits:

```sql
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

alter table public.profiles
  add column if not exists last_scan_at timestamptz;

alter table public.profiles
  add column if not exists timezone text;

alter table public.profiles
  add column if not exists blind_since jsonb;

comment on column public.profiles.last_seen_at is
  'THE FLOOR. Where the next recap''s window starts. Holds the created_at of the '
  'user turn that OPENED the last confirmed recap — deliberately before the model '
  'ran, so rows written during the run are re-reported rather than skipped. NULL '
  'means no recap has ever been confirmed for this account. Written only by '
  '/api/recap/seen, and only for a reply that passes this server''s own envelope '
  'check with FULL coverage of every source that run delegated to the box.';

comment on column public.profiles.last_scan_at is
  'THE PROOF SOMEBODY LOOKED. Holds the created_at of the REPLY row of the last '
  'confirmed recap — the latest possible instant, because this is the number the '
  'words "checked just now" refer to. NULL means no recap has ever been confirmed '
  'with full coverage, which is NOT the same as "never run": a first recap that '
  'came back partly blind leaves this NULL with a real recap on screen, so the '
  'never-run copy is chosen from the ABSENCE OF ANY REPLY rather than from this '
  'column. Advances on an EMPTY result exactly as on a successful one; never on an '
  'error, never on a malformed reply, and never on a run that went partly blind. '
  'Nothing is ever queried against it, which is why it may safely hold the later '
  'timestamp.';

comment on column public.profiles.timezone is
  'IANA zone name (e.g. Asia/Taipei) used to render every time in a recap, header '
  'and body alike. OWNER-CONTROLLED. Written by the owner-only account route, or '
  'seeded ONCE from the calendar zone a completed owner recap reports, and never '
  'by an assistant, never from anything an email said, and never overwritten once '
  'set. NULL means nobody has set one and no run has reported one. The VPS '
  'timezone is never used and never inferred.';

comment on column public.profiles.blind_since is
  'WHEN A SOURCE WENT DARK, so a warning can say since when. One key per '
  'delegated source, holding the created_at of the user turn of the FIRST run in '
  'the current unbroken sequence of blind ones, e.g. {"mail":"2026-09-02T09:20+08"}. '
  'A key is written only if absent, so re-confirming one reply twice — or across '
  'sessions — records nothing new. A key is REMOVED by ANY run that reports THAT '
  'source ok, including a run whose verdict is still partial because a DIFFERENT '
  'source is dark: removal is per key and never waits for a fully covered run, so '
  'the map only ever names sources that are dark right now. NOT A MARK AND NOT A '
  'FLOOR: no window is ever computed from '
  'it, nothing is ever compared against it, and the statement that writes it on a '
  'blind run must never also touch last_seen_at or last_scan_at. It records when '
  'Dovis FIRST FOUND the source unreadable, which may be hours after the '
  'credential actually died, so every string built on it says "has not been able '
  'to read since" and none of them claims to know when access was lost.';
```

`add column if not exists` because `schema.sql` is re-runnable by design — it
uses `create table if not exists`, `create or replace function` and
`drop policy if exists` throughout, and a bare `add column` fails on the second
run and aborts everything after it.

**Why two timestamps rather than one.** They hold different instants, and
collapsing them forces one of two lies. A single column holding the *turn* time
would make the idle line say "checked at 09:20" for a run that finished at
09:21:30 — a small lie, but the empty message's entire job is to be exactly true
about when somebody last looked. A single column holding the *reply* time would
let the window floor swallow the run's own duration, so every row written while
the model was thinking sits below the next run's floor and is never reported by
any recap — the fatal one, traced in full below. Two columns, written in one
statement, from two different rows: the floor from the turn, the proof from the
reply.

**`blind_since` is a third value of a different kind, and holding it apart from
the two marks is what makes it safe.** The marks say how far a recap has been
shown to have covered. `blind_since` says how long a source has been unreadable,
which is the input to the escalation the deployment owner decided on 2026-09-05 and which is
argued out under partial visibility below. It is written on exactly the runs where
the marks deliberately do **not** move, so the two live on different branches
rather than in one statement — and that separation carries weight, because the
tempting shape is a single write that tidies the recap by nudging the floor along
with the warning, which rebuilds by hand the hole this section exists to prevent.
A jsonb map rather than a column per source, because the sources fail
independently and every sentence built on it names its source; and unlike the
per-source *floors* rejected below, nothing is ever compared against this map, so
it cannot produce a window, a header, or a hole. Its only consumers are two
warnings and one count derived at read time.

Both are nullable with no default. A default of `now()` would make the very first
"Catch me up" cover zero elapsed time, which is the one run where the window
matters most. NULL on `last_seen_at` means *no prior review*, the route
substitutes the first-run window decided below, and the header states the window
that was actually used rather than a fixed sentence. NULL on `last_scan_at` means
*no run has ever been confirmed with full coverage*, which is what the empty
message is entitled to speak for — and, per the UI table, is deliberately *not*
what the never-run message is chosen by.

The earlier draft of the `last_seen_at` comment said the column "sits beside
`last_sign_in_at` and means something else: signing in is not reviewing."
**That comparison is wrong in this deployment and has been removed.**
`last_sign_in_at` has exactly one writer —
`src/app/api/auth/password-changed/route.ts` — and `signIn()` in
`dovis-provider.tsx` never touches it, so the column records the last *password
change*. Anchoring a permanent schema comment to that would bake the
misunderstanding in. Renaming the column is a migration plus a route change plus
a `types.ts` change for a column this feature never reads, so it is **recorded
here as a live finding and deliberately not folded into this work.**

**No client code writes the marks, and there is no self-UPDATE policy — but the
owner's browser can still write them today, and an earlier draft asserted
otherwise.** `"owner updates"` in `schema.sql` §4 is
`using (public.dovis_is_owner()) with check (public.dovis_is_owner())`, with no
restriction on which row it applies to — unlike `"owner deletes"`, which carries
`and id <> auth.uid()`. `dovis_is_owner()` is true for the owner on every row
including their own, so the owner's browser, holding the anon key and its own
JWT, can `update profiles set last_seen_at = '2030-01-01' where id = auth.uid()`
straight through PostgREST and permanently blank its own window. That is the
failure this section calls the one that matters, reachable from the client as the
schema stands. It also undercuts the care taken below to have the confirmation
route derive every value it writes, since the column can simply be written
directly.

Nothing in the repo uses that capability: every `profiles` write is server-side
under `service_role`, `/api/team/update` included, and `service_role` bypasses
RLS entirely. **So mirror `"owner deletes"` and add `and id <> auth.uid()` to
`"owner updates"`.** It costs nothing, because no client path relies on the owner
updating their own row, and it closes the only client-reachable way to corrupt
the marks. That one line belongs with the migrations at the foot of this section,
and the timezone decision below depends on it: the whole point of routing the
owner's own timezone through a server route is undone if the browser can write
the column directly.

**Do not, separately, add a client policy to make the browser a legitimate
writer.** Postgres RLS cannot restrict which *columns* an UPDATE touches, so a
self-update policy on `profiles` is a self-update policy on `role`, and that is
the worst line available in this codebase. The established shape is already in
the repo: `/api/auth/password-changed` writes under `service_role` after
`requireProfile()` succeeds, with no client policy at all. The marks follow it,
and so does the timezone.

**`last_seen_at` advances to the moment the window was OPENED, not to the recap
reply.** An earlier draft had it advance to the reply row's `created_at` and
claimed open-ended windows have no seam under any clock. **That was a logic error
and it produced exactly the failure this section calls the one that matters.**
Trace it. Hermes reads the sources at T1 and inserts the reply at T2, and a
mail-and-calendar summarisation on a 4GB box is tens of seconds, not
milliseconds. If the floor becomes T2, every row written in (T1, T2] was too late
for this run to read and is already below the next run's floor. **No recap ever
reports it.** A whole model-run's worth of mail, silently, every single time.

Advancing to T0 — the instant the window opened, before Hermes was called —
collapses the seam in the safe direction. Rows written in (T0, T1] are read by
this run *and* sit above the new floor, so the next run repeats them. Repetition
is the benign failure; a hole is not. `last_scan_at` may take T2 precisely
because it is not a floor and nothing is ever compared against it.

**Take T0 from Postgres, not from Node.** `todos.created_at` is a Postgres clock
value, and the recap's whole windowed half is a comparison against it. A
`new Date().toISOString()` taken on Vercel introduces a skew between two clocks
into the one predicate that must not have one. The user turn `/api/recap` inserts
before forwarding already carries a Postgres `default now()`, so read it back
with `.select()` and use that: it is the request time, it is on the right clock,
and it is provably before Hermes read anything. T2 comes from the reply row's
`created_at`, which is on the same clock for the same reason.

**Advance both monotonically** — `greatest(column, $1)` — because the two
directions are not symmetric. A mark that lands too far back shows the boss an
item twice. A mark that lands too far forward loses it silently. `greatest`
ignores NULLs in Postgres, so the first run needs no `coalesce`. With one writer
this is now an invariant rather than a hope: there is a single statement, in a
single route, and it is the one below.

#### Who writes the marks — decided 2026-09-05: this server, not Hermes

**The earlier draft recommended that Hermes stamp the mark in the same
service-role write that inserts the reply, and called the dashboard-side route a
measurably weaker fallback. That recommendation is reversed.** The deployment
owner's instruction is that the authenticated dashboard server writes it. The reasoning
below is rewritten rather than annotated, because the old reasoning reached a
conclusion this document no longer holds.

Start from what is known, and when. The webhook response is an acknowledgement
that the run was accepted, not the answer. So `/api/recap` cannot know that a
recap succeeded; at the moment it returns, nothing has happened yet. Advancing on
that acknowledgement would burn the period on a run that then dies on the box,
and the boss would lose that window permanently with no way to know. That much
the earlier draft had right, and it is still the reason nothing is written at
trigger time.

The knowledge arrives later, and it arrives in exactly one form: **the reply row
appears.** That is the event, and — this is what the earlier draft undervalued —
it is an event *this side can see*. `messages` is in the realtime publication, so
the row reaches the browser the moment it is written. So the write happens then,
from a route the browser calls once the reply is in hand:

```
POST /api/recap/seen
{ "replyId": "<the dovis row that just arrived>" }
```

**One id, and never a timestamp, and never a result.** An earlier draft had the
client pass the recap row's `created_at` directly, which hands a buggy or hostile
client the ability to send any future timestamp and permanently blank a window —
the failure above, on demand. `requireProfile()` establishes *who is calling*,
not *what they may claim about a row*, and this repo makes that distinction
carefully everywhere else. The route derives and validates every value it writes,
from rows it loads itself.

**The reply names its own turn, and that is what makes the pair safe.**
Server-side, after `requireProfile()`, under `service_role`: load the reply by
id; reject unless it is `role = 'dovis'` and carries the caller's own
`author_id`. Read `meta.turn_id` — the id `/api/recap` sent to Hermes, echoed
back on the reply — and load that row; reject unless it is `role = 'user'`,
carries the same `author_id`, sits in the same conversation, has a `created_at`
strictly earlier than the reply's, and carries a request `meta` of this server's
own making.

**An earlier draft took the turn id from the browser and checked only that the
two rows co-existed in one conversation in the right order. That is an arrival
proof, not a provenance proof**, and the gap is the same hole the paragraphs
above spend so long closing. The recap conversation is an ordinary conversation
in the Gemini-style list — every recap in one scrollable place — and the
`disabled` guard covers the recap *trigger*, not the composer. So the boss typing
an ordinary question at 10:00 while a run launched at 09:00 is still thinking is
a normal event. Pair that 10:00 turn with the 09:00 run's reply and the floor
jumps to 10:00: everything in (09:00, 10:00] sits below every future floor and no
recap ever reports it. Deriving the turn from the reply removes the client's
ability to mispair at all, and it is why the ordering test is a sanity check
rather than the argument.

**If Hermes cannot echo the id, require unambiguity instead — and make the
ambiguity itself the rejection, not a row position.** The tempting fallback is
*pair the reply with the newest `role = 'user'` row older than it, and reject if
another user row sits strictly between the two*. **That rule is broken, in
precisely the way this subsection exists to prevent.** Take the case above: a
recap turn at 09:00, an ordinary typed question at 10:00, the recap's reply at
10:05. The newest user row older than the reply is the 10:00 turn, so the
interloper *becomes* the row being paired, and the between-test then asks whether
anything sits between the interloper and the reply — which nothing does. The
confirmation is accepted, the floor takes 10:00, and the run only ever read to
T1 ≈ 09:01. Everything in (09:01, 10:00] is below every future floor for ever.
The test cannot see the mistake it is making, because the mistake is the thing it
is testing.

So state the rule over the whole unanswered run rather than over two adjacent
rows: **refuse the confirmation whenever more than one `role = 'user'` row in
that conversation is newer than the previous `dovis` row** (or newer than the
conversation's start, if there is none). Exactly one unanswered user turn means
the pairing is unambiguous and that turn is the run's own. Two or more means the
run's turn cannot be identified without the echo, and the route refuses. Say
plainly what that costs, because it is not free: **on this branch, any typing
during a run costs that run its confirmation.** The marks do not move and the
next recap re-covers the period. That is the price of not having the echo, and it
is paid in repetition rather than in a hole.

Deriving the pair from the reply also gives the confirmation a durable home.
Nothing depends on the tab that started the run still being open: any load of the
thread can reconstruct the pair, which is what makes the reconciliation below
possible at all. Then the two `meta` blobs are checked against each other, and
only a verdict of `advance` reaches the marks:

```sql
-- The ADVANCE branch, and only this branch touches a mark.
update public.profiles
   set last_seen_at = greatest(last_seen_at, <turn.created_at>),
       last_scan_at = greatest(last_scan_at, <reply.created_at>),
       timezone     = coalesce(timezone, <validated zone from reply.meta>),
       blind_since  = nullif(coalesce(blind_since, '{}'::jsonb)
                             - <the verdict's covered sources, as text[]>,
                             '{}'::jsonb)
 where id = <the caller's profile id>;
```

One statement, so the two marks can never disagree about whether a run happened.
The third assignment is a seed rather than a mark — it fills an empty column and
can never overwrite a zone the owner set, which is the direction the deployment
owner's timezone decision requires and the *opposite* of the direction an earlier draft wrote it
in; that flip is argued in the timezone section below. It is included only when
the caller is the owner, because only the owner's account has a calendar for a
run to have read. The fourth clears the darkness record for every source this run
actually read, which on this branch is every source it delegated — full coverage
is exactly what "no source is dark" means, so this branch always empties the map
outright. It is not, however, the only place that clears: the partial branch
below subtracts the same `covered` list, because a run can read one source and
fail another, and the key for the source that *did* read must not survive the run
that read it. The route returns the verdict it computed, the id of the reply it
evaluated, and all four column values, and the browser patches its session from
that response, which is authoritative because the route has just written it.

**A verdict of `partial` writes too, and what it writes is the whole of the
argument.** It records darkness and it moves nothing:

```sql
-- The PARTIAL branch. What is ABSENT from this statement is the point:
-- last_seen_at and last_scan_at are not here, and must never be added. Existing
-- keys win over new ones because the incoming object is on the LEFT of `||`, so
-- this records the FIRST run that found the source dark rather than the latest,
-- and re-running it for the same reply changes nothing. The subtraction sits
-- INSIDE the right operand, so a source this run DID read loses its key even
-- though the run as a whole stayed blind on another one — and the incoming
-- object still wins for the sources that are still dark.
update public.profiles
   set blind_since = nullif(
         <one key per blind source, valued turn.created_at>::jsonb
         || (coalesce(blind_since, '{}'::jsonb)
             - <the verdict's covered sources, as text[]>),
         '{}'::jsonb)
 where id = <the caller's profile id>;
```

**The subtraction is what stops a recovered source fossilising in the map.** Mail
goes dark on Monday while the calendar reads fine, so `blind_since` is
`{"mail":"Monday"}`. On Tuesday mail comes back and the calendar fails. The
verdict is `partial`, so nothing advances and nothing should — but `covered`
holds `mail`, the subtraction drops Monday's mail key, and the map is left saying
only what is true: the calendar has been dark since Tuesday. Without it, mail's
Monday key survives until a fully covered run, which is precisely the run the
still-dark calendar prevents. Both warnings would go on naming mail — "has not
been able to read your mail and your calendar since Monday", false about mail,
which was read on Tuesday — and at 72 hours the card would escalate a working
source to the destructive treatment. A warning that names a source the boss can
see working is the fastest way to teach him to ignore the one that isn't.

Say the invariant out loud rather than leaving it to the reader of two SQL
blocks: **a run that went blind records that it went blind and advances
nothing.** Not the floor, not the proof, not "just a little, to keep the recap
tidy". The warning exists because the period was not covered; a warning that
moved the mark would be announcing a hole while digging it.

A verdict of `errored` or `malformed` writes **neither** statement. A reply the
dashboard could not read is not evidence that a source is unreadable — it is
evidence that the run failed, which is a different claim — so it leaves
`blind_since` exactly where it was, and a genuinely dark source is recorded by
the next run that comes back readable enough to say so.

**Note what the floor takes.** It is the *turn's* timestamp, not the reply's,
even though the reply is the row being confirmed and is sitting right there in
the same query. That is the whole (T1, T2] argument above, and it survives the
reversal untouched: writing the reply's `created_at` as the floor would
reintroduce the silent hole on the branch that now actually ships. The reply's
timestamp goes to `last_scan_at`, where nothing is ever compared against it.

**The residual, stated rather than hidden: if no browser ever confirms a reply,
the marks do not advance — and the cost is not the same on the two columns.** On
`last_seen_at` it is repetition: the next recap covers a period the boss has
already read, which is the benign direction. On `last_scan_at` it is that the
idle line goes on quoting an older review, or none at all, while a completed
recap sits in the thread a scroll away. The one collision that would be
indefensible — "No recap has been generated yet." printed directly above the
recap it generated — is closed structurally rather than by timing, because the
never-run copy is chosen from the absence of any `dovis` reply rather than from
this column; see the UI table. But an unconfirmed reply still leaves both marks
behind the truth, and the 90-second refetch does not rescue it: in the failure
being described the socket is the thing that is down, that single refetch has
already fired and found nothing, and nothing fires again.

**So the confirmation is not tied to the run that launched it. On loading the
recap thread, the browser reconciles.** If the newest `dovis` reply in that
conversation carries a recap envelope, is newer than the session's
`last_scan_at`, and has not already been evaluated in this session, the browser
posts that reply to `/api/recap/seen` there and then. The route runs the same
checks, derives the same pair from the same `meta`, and `greatest()` makes a
repeated confirmation a no-op. A reply that was missed while the socket was down
is therefore confirmed on the next page load, both columns converge, and the
comment on `last_scan_at` stays true.

**That "not already evaluated" clause is what terminates the loop, and it is not
optional.** The `newer than last_scan_at` test is self-limiting only for replies
that *advance*, and three classes never do: `partial`, `errored` and `malformed`
all leave the column where it was, so the test stays true for ever and every
single load of the thread would re-post the same reply id — re-authenticating,
re-reading two rows under `service_role`, re-running the validator and refusing
again, for as long as a Google credential stays expired, which this document says
can be days. So `/api/recap/seen` returns the id of the reply it evaluated
alongside its verdict, and the browser remembers the ids it already has a verdict
for — component state, or `sessionStorage` keyed by conversation. **A
non-advancing reply is therefore confirmed at most once per session rather than
once per load**, and `greatest()` covers correctness across sessions the way it
always did.

With that in place the residual really is repetition, and only until the next
load: a reply that lands unseen leaves the next recap covering a period already
read. That fails **safe** — repetition, never a hole — and it is now a named
property of the design rather than a gap in it. The 90-second refetch is what
keeps even that rare within a session.

**The reversal also shrinks what Hermes has to be trusted with, which is worth
saying plainly.** The old recommendation required a Hermes-side write into
`profiles`. What remains is smaller: Hermes must be told which profile it is
answering for, so the reply row carries the right `author_id` and the run scopes
to the right account, and it must put this server's envelope — and the id of the
turn it answered — on the reply. None of that is a stamp into `profiles`, and
none of it gives the box write access to the account table.

**Being told the profile id is still a field that has to be added, and so is the
turn id.** Neither `WEB-CHAT-DESIGN.md` nor Hermes' integration answers describe
either one crossing the wire — step 2 says the route forwards "the last N turns",
and Hermes' §2 step 4 says the same. So `/api/recap` sends both and Hermes accepts
them; the echo is what the confirmation route reads back.

#### The result envelope is this side's contract — revised 2026-09-05

**An earlier draft of this section rested on the deployment owner's decision that the reply
carries an explicit result, and quietly treated that as something the transport
provides. Hermes' answer of 2026-09-05 is that it does not.** The webhook response
must not be assumed to be a machine-readable envelope at all. **The recap server
defines and validates its own structured result — `success | empty | partial |
error` — including partial visibility such as "Gmail unavailable but Calendar
available."**

**The enum is four values, and `partial` is one of the four because the deployment
owner named it.** It is not a state inferred from a `success` whose coverage came
back short, and writing it as a three-value enum plus a derived case would lose
the thing they asked for: a reply is allowed to say outright that it went partly blind. The
dashboard does not depend on it saying so — coverage still decides, and a
`success` with a short coverage map is a `partial` verdict regardless — but a box
that volunteers the bad news must have a literal to volunteer it in.

So the four-value result is not a fact about Hermes. It is a shape this side
writes down, demands, checks, and refuses to act on when it does not arrive. That
distinction changes very little about what gets built and everything about where
the guarantee lives, so it is worth being exact about both halves.

**Where the two halves live.** One nullable column on the table the chat
migration already creates, carrying a *request* record on the user turn and a
*result* record on the reply:

```sql
-- Belongs in the chat migration, with the table it sits on.
alter table public.messages
  add column if not exists meta jsonb;

comment on column public.messages.meta is
  'Structured sidecar; NULL on ordinary turns. A recap REQUEST turn carries what '
  'this server asked for — {"kind":"dovis.recap.request.v1","delegated":["mail",'
  '"calendar"],"ahead_days":7,"timezone":"Asia/Taipei","lang":"zh-TW",'
  '"since":"..."} — written by /api/recap before Hermes is called. A recap REPLY '
  'carries what came back: {"kind":"dovis.recap.v1","turn_id":"<the user turn '
  'this run answers, on the echo branch>","result":"success"|"empty"|"partial"|'
  '"error","coverage":{"mail":"ok","calendar":"unavailable"},'
  '"timezone":"Asia/Taipei"}. content stays the prose. '
  'Both halves stream over Realtime with their rows, so neither may hold anything '
  'the select policy does not already permit — no payload bodies, no filesystem '
  'paths, no secrets.';
```

**The shape, in one file, on one side.** `src/lib/recap.ts` holds the definition
and the validator, and **both are server-only.** `/api/recap/seen` is the single
producer of a verdict; the browser renders from the verdict that route returns
and never calls the validator itself. That is not tidiness. Pairing a reply to
its request turn is the one operation this design deliberately denies the client,
and the browser has no `service_role` read to do it safely — on the
reconciliation path it may not even hold the request turn, if the thread is
paginated. A browser that validated for itself would need exactly the capability
the previous subsection spends its length removing:

```ts
// The sources this run DELEGATED to the box. The queue delta and the caller's
// own unresolved threads are deliberately absent: /api/recap assembles those
// itself, so asking the box to vouch for them would be asking it to echo.
export const RECAP_DELEGATED_SOURCES = ["mail", "calendar"] as const;
export type RecapSource = (typeof RECAP_DELEGATED_SOURCES)[number];

/** Written by /api/recap onto the USER turn, before Hermes is called. */
export interface RecapRequest {
  kind: "dovis.recap.request.v1";
  delegated: RecapSource[];   // [] for an assistant; ["mail","calendar"] for the owner
  ahead_days: number;         // the forward horizon, stated rather than implied
  timezone: string;           // IANA name; the box is never left to infer one
  // "en" | "zh-TW" — a PROMPT hint, never a toolset. `import type { Lang }` from
  // i18n.ts, not a plain import: that file is "use client", and a type-only
  // import is erased rather than pulling a client module into a server one.
  lang: Lang;
  since: string;              // the floor this run was given
}

/** Expected on the DOVIS reply. Anything failing this is not a recap. */
export interface RecapResult {
  kind: "dovis.recap.v1";
  turn_id?: string;           // present on the ECHO branch; absent under adjacency
  result: "success" | "empty" | "partial" | "error";
  coverage: Partial<Record<RecapSource, "ok" | "unavailable">>;
  timezone?: string;          // the zone the run actually rendered times in
}

export type RecapVerdict =
  | { advance: true;  result: "success" | "empty"; timezone: string | null;
      covered: RecapSource[] }
  | { advance: false; reason: "malformed" | "errored" | "partial";
      blind: RecapSource[];
      // The mirror of `blind`, computed exactly as on the advance branch:
      // `delegated` intersected with the keys the reply reported "ok" for. It
      // drives nothing on screen here — it is carried because the PARTIAL
      // statement SUBTRACTS it, which is how a source that recovered on a run
      // that stayed blind on another one loses its blind_since key. Empty on
      // `malformed` and `errored`, which write neither statement.
      covered: RecapSource[];
      // `partial` only, and both are FILLED BY THE ROUTE after this pure
      // function returns — `since` from the blind_since map the route has just
      // written, `runs` from a bounded read of the conversation. Neither is ever
      // stored as a counter, so a reply re-confirmed in a later session
      // recomputes the same two numbers instead of inflating them.
      since?: string | null;
      runs?: number };

/** `request` and `reply` are the raw `meta` values as loaded from Postgres,
 *  never anything the browser sent; `turnId` is the id of the turn the route
 *  actually derived. Narrowed by hand — there is no zod in this repo and this
 *  is one function, not a validation layer. */
export function verifyRecapReply(
  request: unknown,
  reply: unknown,
  turnId: string,
): RecapVerdict;
```

**`covered` is on both branches, because on one the UI needs it and on the other
the write does, and neither may compute it for itself.** It is `delegated`
intersected with the keys the reply reported `"ok"` for. On the advance branch it
is what `recap.ahead` is gated on — see the two intersection rules below. On the
non-advance branch it drives nothing on screen, since the period header is
withheld there and `recap.ahead` is withheld with it; it is carried because the
partial statement subtracts it, and a route holding only `blind` would have no
way to name the sources that *did* read and so no way to drop the key of one that
recovered on a run that stayed blind on another.

**Validation is structural first and semantic second.** `kind` is checked before
anything else, and it carries a version. A box upgraded to emit a different shape
then fails closed — `malformed`, no advance — instead of being silently
misread by a validator that happens to find the fields it was looking for in a
document that means something else. That is the whole reason the discriminator is
there; a bare `{result: "success"}` would be indistinguishable from any other
JSON object that happened to have that key.

Then: `result` must be one of exactly four literals — `success`, `empty`,
`partial`, `error` — and `coverage` must be an object whose values, for the keys
that matter, are one of exactly two literals. **`partial` is a floor on the
verdict, never a ceiling.** A reply declaring `partial` cannot advance whatever
its coverage map says, so a box that knows it went short can say so directly; a
reply declaring `success` is still reduced to a `partial` verdict when coverage
falls short of `delegated`, so a box that forgets to say so gains nothing. The
literal can only ever make the verdict worse, which is the same direction
coverage runs in and the reason neither can be used to widen anything.
Unknown keys are ignored rather than rejected, so the box may report a source
this dashboard has not heard of without breaking every recap — and an unknown key
can never widen anything, because **both** gates that read `coverage` are
computed against `delegated`: the advance gate below, and the `recap.ahead`
render gate, which used to read the reply alone and no longer does.

**`turn_id` is optional, and which branch is in force is a deployment fact rather
than a per-reply guess.** If the box echoes the id, the route requires it: a
reply without one is malformed, and a reply whose `turn_id` disagrees with the
turn the route derived is rejected outright. If the box cannot echo, the route is
on the adjacency rule above and `turn_id` is simply absent — the pairing came
from the unanswered-turn test and the envelope has nothing to add. **These two
must be configured together.** A deployment silently on the fallback while the
validator is pinned to the echo renders every recap as a failure and advances
nothing, for ever, which is why the branch is one module constant rather than
something inferred from whatever happened to arrive.

**What happens when validation fails.** A reply that does not conform is not a
successful recap, and it is not a failed recap either — it is a reply the
dashboard cannot interpret. Three consequences, and none of them is "assume the
best":

- **Neither mark advances.** `malformed` is treated exactly as `errored` for the
  purposes of the floor. The next recap re-covers the period.
- **No period header attaches to it.** The header is a claim about what the run
  covered, and a run whose result cannot be read has not been shown to have
  covered anything. `recap.sinceDate` and `recap.ahead` are both withheld.
- **The prose still renders.** The reply is a real row in a conversation the boss
  can scroll, and hiding it would leave him wondering what the box said. It
  renders as an ordinary Dovis bubble with `recap.runFailed` beneath it. The
  boss sees the same sentence he would see for any other failure, because the
  distinction between "the box died" and "the box answered in a shape we do not
  recognise" is an operator's distinction and there is nothing he can do with it.

The operator's half of that goes in the server log, not in the chat. A run of
`malformed` verdicts means the box and the dashboard disagree about the contract,
which is a deploy-skew condition that will affect *every* recap until somebody
looks — so it is worth being loud about in the place where loudness helps.

**`verifyRecapReply` is pure, server-only, and it gets a unit test.** Vitest is
already a devDependency and `npm test` already runs it, so
`tests/recap-envelope.test.ts` costs almost nothing: one fixture per verdict —
conforming and complete, conforming and short of coverage, `result: "error"`, and
three flavours of malformed (missing `kind`, wrong `kind`, `coverage` absent) —
plus three that pin the rules an implementer is most likely to soften. A
conforming reply with **no** `turn_id`, on the adjacency branch, must still
verify. An assistant's `delegated: []` request against a reply claiming
`coverage: {calendar: "ok"}` must come back with `covered` empty. And an explicit
`result: "partial"` whose coverage map reports every delegated source `"ok"` must
still refuse to advance — the literal is a floor, and a test is the only thing
that stops someone "simplifying" it into a value derived from coverage. This is the
cheapest test in the feature and it guards the only function that decides whether
a window is burned — and, now, whether a forward claim is printed.

**Does the conclusion of the previous subsection still hold?** It has to be asked,
because the reversal that put the pen in this server's hand was argued partly on
"the reply carries an explicit result", and that premise has just been demoted
from a Hermes guarantee to a house rule.

It holds, and it holds *more* strongly rather than less. What the confirmation
route needs is not a result it can *trust*; it is a result it can *check*. Every
failure this side can actually observe now fails closed: a box that crashed
writes an `error` row or nothing at all, and neither advances; a box that went
partly blind reports coverage, and that does not advance either; a box that emits
garbage fails the `kind` check, and that does not advance. The one case no
arrangement can catch is a box that lies — that claims `coverage: {mail: "ok"}`
for a mailbox it never opened. And in exactly that case the alternative is worse,
not better: if Hermes held the pen, a lying or buggy box would write the mark
into `profiles` directly with nothing checking it at all. **The weaker the
guarantee about what the box sends, the more valuable it is that the box does not
hold the pen.**

What genuinely weakens is the confidence interval on the word `success`. It used
to be described here as a run reporting that it looked. It is now a run
*asserting* that it looked, in a shape this side could check. The floor's
guarantee is correspondingly narrower: it advances only past what the box
asserted it read, never past what the box declined to claim. That is a real
downgrade and it should be written in those words rather than smoothed over. It
is also the strongest guarantee available to any design where the reading happens
on a machine the dashboard cannot see.

#### Partial visibility: one floor, advanced only on full coverage — decided 2026-09-05

The floor is one timestamp covering every source, and until now that was where
the remaining hole was. A recap whose Google refresh token has expired can still
produce a perfectly readable reply about the queue. If that reply reported
`success`, the floor advanced, every mail item in (previous floor, T0] fell below
every future floor, and **no recap ever reported it** — the same silent hole as
the T2 error, arriving on the mail axis instead of the timing axis, and the
likeliest of the three to actually happen, because an expired refresh token is
routine.

The envelope closes it, and it closes it without asking the box to volunteer bad
news. **The dashboard supplies the set of delegated sources; the reply can only
ever subtract from it.** `/api/recap` wrote `delegated` onto the user turn before
Hermes was called, so the confirmation route knows what was asked for from a row
the box never touched. A source that is requested and reports `"unavailable"` is
blind. A source that is requested and **is not mentioned at all** is also blind —
absence is failure, not silence. That inversion is the whole trick: a box that
forgets to report a failure produces the same verdict as a box that reports it.

Then the rule, in one sentence: **the floor advances only when every delegated
source reports `ok`.** One floor. Not per-source.

**Per-source floors were the obvious alternative and they are rejected.** The
shape would be four columns, or a jsonb map, each advancing on its own source's
coverage — so a mail-blind run would still bank the calendar half. Three costs,
and the third is the one that decides it:

The schema stops being two timestamps and becomes a map that every query, every
comment and every future source has to agree about. That is annoying rather than
fatal.

The `greatest()` invariant multiplies. One statement in one route becomes N
assignments whose failure modes differ per key, and the property that "the two
marks can never disagree about whether a run happened" is exactly what is being
given up.

And the header becomes unwritable. **A recap is a statement about a period.** The
line above it says *"Since your last review — 5 September 2026, 09:20"*, and the
boss reads the paragraphs underneath as covering that period. With per-source
floors there is no such period: the mail paragraph covers since Tuesday, the
calendar paragraph covers since this morning, and the queue paragraph covers
something else again. Either the header states the earliest floor — in which case
it under-claims for three sources out of four and the boss re-reads material that
was already banked, which is the cost of the option that was supposedly avoided —
or it states four periods, and the header stops being a sentence. Worse, Dovis
itself would have to be told four floors and be relied upon to respect the right
one per paragraph, in prose, where nothing checks it. **One message, one period.**

**What the losing option would have bought, and therefore what full-coverage-only
costs.** With one floor, a single blind source blocks *everything*. An owner
whose Google token expired on Tuesday gets a recap every morning that repeats the
queue delta he already read on Tuesday, on Wednesday and on Thursday, and the
window keeps widening until somebody reconnects Google.

That cost is real and it should not be minimised, but three things make it the
right trade. **It repeats the cheap half.** The material that gets re-reported is
the queue delta and the unresolved threads — the halves `/api/recap` assembles
itself, out of `todos` rows that are small, bounded by activity, and already
partly repeated by design, since open, `failed`, `modifying` and high-priority
items are reported unconditionally on every run regardless of the window. Nothing
re-reads a mailbox. **It is loud, and it gets louder.** Every one of those recaps
names mail in a warning, so the degraded state announces itself daily instead of
hiding behind a clean-looking recap that quietly covers less than it says — and
from the second day the warning escalates, on the schedule set out immediately
below.
**And it is lossless.** The moment Google is reconnected, the first fully covered
run advances the floor from wherever it was still sitting, and everything that
accumulated in between is reported in that run rather than skipped. The floor
that never moved is the thing that saves the window.

The one cost with no compensating story is the width of that catch-up run after a
long blind period — a recap asked to cover thirty days of queue history. The
tempting fix is to cap how far back a run looks, and **the cap must not be
built**: a run capped at seven days while the floor sits thirty days back reports
nothing from days eight to thirty, and the next capped run does the same, which
is a hole rebuilt by hand. If the width of a catch-up recap becomes a real problem
it is a prose problem — Dovis summarising a long period more coarsely — never a
floor problem.

**Escalation, decided 2026-09-05.** The same daily `recap.partial` line for a
credential that died last Tuesday is a warning the boss has already learned to
scroll past, and the deployment owner closed that with a two-part instruction: after 24 hours,
show a persistent and stronger warning naming the time — *"Email access has been
unavailable since [time]. This recap may be incomplete."* — and escalate visually
after repeated failures. That instruction ends with the sentence that governs the
whole of it: **never advance `last_seen_at` past unread or unavailable email
data.** Everything below is a change of *volume*, and nothing below is a change of
*floor*.

**Level one — any blind run.** The chat renders `recap.partial`, exactly as it
does today, naming the blind sources. The Team page shows nothing. One bad morning
is a blip, and a dashboard-wide banner for a blip is how a warning gets ignored by
the time it means something. The floor does not move.

**Level two — the source has been dark for 24 hours or more**, measured from its
key in `blind_since` against the current run's turn time. The chat line becomes
`recap.partialSince`, which names the source *and the instant*, so the boss reads
a duration rather than a repeated complaint. And the warning leaves the chat: the
**Team page's Google card** renders `googleBlindWarning` persistently — on every
load of that page, with no recap on screen and no chat open. That is what
"persistent" has to buy, because the boss who has stopped opening the chat is
exactly the boss who most needs telling, and the card is where the fix lives: the
`googleReconnect` button is already six inches away. The floor still does not
move; `recap.partialSince` says so in the same sentence, reusing `runFailed`'s
second clause the way `partial` already does.

That the card is behind `Gate requireOwner` costs nothing, and it is worth saying
why rather than leaving a reader to wonder whether assistants are being kept in
the dark. An assistant's run delegates nothing, so an assistant's `blind_since`
is permanently empty and there is no warning of theirs to hide. The only account
that can go blind is the only account that can see the card, and it is the only
account that could fix the credential anyway.

**Level three — repeated failure.** The chat adds `recap.partialRepeated` on its
own line beneath `partialSince` once **three or more consecutive confirmed runs
have reported the same source short**, and the Google card's warning takes the
destructive treatment the Danger zone already uses — same tokens, not a new
colour — and gains `googleBlindStale` once `blind_since` is **72 hours or more**
old. This is the visual escalation the deployment owner asked for, and it is the last one: there
is no level four, because a warning that keeps growing teaches the reader that the
current size is never the real size. The floor still does not move, and it must
not be made to: a design that resolved a loud warning by advancing the mark would
be announcing a hole while digging it.

**Those are two thresholds for one escalation, and the reason is the next
subsection rather than an oversight.** The chat escalates on a count of runs
because the route that renders it has the rows in hand; the card escalates on
elapsed time because the Team page has `profiles` and nothing else. Three runs
and three days are the same event for a boss with a daily habit, and each surface
states the axis it actually measured rather than borrowing the other's word.

**The count decides; the timestamp speaks.** Level three's chat half is *gated* on
the number of consecutive blind runs, but no rendered string interpolates that
number. `recap.partialRepeated` says "three or more in a row", which the gate has
already proved and which no cap can falsify, and every quantity a reader actually
sees — the instant in `recap.partialSince`, the day count in `googleBlindStale` —
is computed from `blind_since`, a recorded timestamp. That split exists because of
how the count is obtained.

**The count is derived at read time and never stored.** `/api/recap/seen`, which
already holds the conversation under `service_role`, reads that conversation's
newest `dovis` replies newest-first and counts forward while each reports the
source short, stopping at the first reply that reports it `ok` or after twenty
rows. It returns the number on the verdict, and the browser renders from the
verdict as it does with everything else on this route. **A counter column would be
wrong here, not merely heavier.** The reconciliation path re-confirms a reply the
browser missed, and `greatest()` makes a repeated *advance* a no-op precisely
because it is idempotent; an incremented counter is not, so one reply confirmed
again in a later session would inflate the number and escalate a warning on
evidence that did not exist. Recomputing costs one bounded query on a route that
runs once per recap.

**The twenty-row bound cannot change a rendered decision**, which is the reason it
is safe: the only threshold is three, so a walk that stops at twenty has long
since decided. It bounds the query, not the truth.

**Where the two axes disagree, each string still tells the truth about its own.**
A boss who runs one recap a week reaches 72 hours long before he reaches three
runs, so the card can be shouting while the chat is not — which is right, because
three days *have* passed and three recaps have not. Neither string ever says a
bare "repeatedly": the chat line says *recaps in a row*, the card says *days*, and
a reader can always tell which question was asked. Giving the card the count
instead would mean either a second query on a page that makes none, or a stored
counter, and the paragraph above rules the counter out.

**Recovery of a source and recovery of the floor are two different events, and an
earlier draft collapsed them.** A source's key leaves `blind_since` on the first
run that reports *that source* `ok`, whichever branch the verdict takes: the
advance branch empties the map, and the partial branch subtracts `covered` too,
so mail coming back on a run the calendar is still failing clears mail's key on
that same run. Both warnings stop naming mail immediately, which is the whole
point of recording darkness per source. The *floor*, by contrast, advances only
on full coverage, because a run that could not read the calendar has not covered
the period and the mark either says it has or says nothing. So the last source to
recover is the one holding the floor, and when it reads, the floor advances from
wherever it had been sitting all along — the catch-up run reports everything that
accumulated during the outage. That is the lossless property argued above, and
the escalation was only ever the noise around it.

**`last_scan_at` is gated identically, and that is deliberate.** A partially blind
run could be argued to prove *somebody looked*. It does not prove the sentence
that column exists to license: "Checked at 09:20 — nothing new." A run that could
not open the mailbox is not entitled to say *nothing new*, so both columns move
together or neither does, in the one statement they already share.

**The mechanism also retires an instruction that used to be a note — but only if
the render gate is computed the same way as the advance gate.** `recap.ahead` —
"Plus anything scheduled in the next 7 days" — renders only when `calendar`
appears in the request turn's `delegated` **and** the reply reports `"ok"` for
it; that intersection is what the verdict's `covered` holds. Gating it on the
reply alone would leave one place where the reply can *add* rather than subtract:
a buggy or upgraded box that put `coverage: {calendar: "ok"}` on an assistant's
run would print a forward calendar claim above a recap that read no calendar and
could not have. Computed as the intersection, the guarantee falls out of the data
instead of out of a code review — an assistant's run delegates nothing,
`delegated` cannot contain `calendar`, and the line cannot render whatever the
reply says.

#### How the browser learns the new marks

**It does not learn them on its own, and the earlier draft missed this.** The
columns arrive free at bootstrap on both existing read paths — the provider does
`.from("profiles").select("*").eq("id", user.id).single()` and `requireProfile()`
does the same server-side — but nothing refreshes them afterwards. `profiles` is
**not** in the realtime publication (`schema.sql` §5 adds only `todos` and
`dashboard_widgets`), so a service-role write never streams. And `fetchAll()`
never touches `session.profile`: for an owner it refetches the profiles *list*
into separate state, and for an assistant it deliberately returns
`profiles: null`. So without a fix, the second click of the day still renders the
first window's date, for the rest of the session.

The fix is the shape the provider already uses — but **the window and the marks
are different values, and only the marks are durable.** `/api/recap` returns at
T0, before Hermes has been called and before anything has been stamped; the run
may die on the box, in which case the database correctly keeps the old values.
Writing that returned window into `session.profile.last_seen_at` would have the
browser believe a floor the database does not hold, and the next trigger would
then claim a narrower period than the run it launches actually covers — the one
thing the header must never do.

So keep them apart:

- **The window and zone `/api/recap` returns are per-run state**, held for that
  run's header and nothing else. They are what the pending bubble and the
  delivered reply are labelled with, and they never touch the session.
- **`session.profile.last_seen_at`, `last_scan_at`, `timezone` and `blind_since`
  are patched only from the `/api/recap/seen` response**, which returns the
  verdict it computed, the reply id it evaluated, and exactly what it wrote —
  including on the reconciliation call, which is that same route, and including
  on the `partial` branch, which writes `blind_since` while writing no mark at
  all. There is no second path and no inference: if no confirmation happened, or
  the route refused to advance, the session keeps the old values, which is the
  truth.

The patch itself is the idiom `changePassword` already uses:

```ts
setSession((s) =>
  s
    ? {
        ...s,
        profile: {
          ...s.profile,
          last_seen_at: seen,
          last_scan_at: scan,
          timezone: zone,
          blind_since: blind,
        },
      }
    : s,
);
```

`blind_since` is in that patch specifically because the Team page's Google card
reads it, and the card is a different surface from the chat: a boss who confirms a
blind recap and then navigates to Team must find the warning already there rather
than after a reload.

`Profile` in `src/lib/types.ts` gains `last_seen_at: string | null`,
`last_scan_at: string | null`, `timezone: string | null` and
`blind_since: Partial<Record<"mail" | "calendar", string>> | null` in the same
change — that file's own comment requires it to mirror the schema exactly. The
union is spelled out rather than imported as `RecapSource`, because `recap.ts` is
server-only and `types.ts` is read by the browser — a duplicated two-member union
is a smaller cost than a client file importing a server one, and it is the same
trade `types.ts` already makes against the schema. **That will
break the build until the fixtures are updated, which is the point:**
`demoProfiles` in `src/lib/demo-data.ts` is typed `Profile[]` and built from
plain object literals, so four new required fields fail `tsc` there immediately.
The fixture in `tests/payload-route.test.ts` ends in `as Profile` and compiles
regardless. So it is the demo data — not the tests — that the compiler forces you
to think about, and the demo data is exactly where you have to decide what a
sample recap claims about itself.

#### The `is_owner()` duplicate, now fixed upstream

An earlier draft of the chat schema above introduced `public.is_owner()` beside
the `public.dovis_is_owner()` that `supabase/schema.sql:157` already ships. This
review caught it and the Schema section has been corrected in place, so there is
nothing left to carry into the chat PR.

Recording it because the *class* of mistake will recur: a design document written
against a remembered schema invents helpers the real schema already has, and two
functions with one meaning drift apart across migrations. The check is cheap —
grep the schema for the helper before writing a policy that needs one.

### The window: seven days back, seven days forward — decided 2026-09-05

**The first-ever recap covers the last 7 days, and every recap looks 7 days
forward for meetings.** The deployment owner settled both halves together, which is right,
because they were always the same product-visible span pointing in opposite
directions.

Seven days back rather than twenty-four hours, because the first run is the one
where a short window is least defensible: a box that has been running for a while
has a backlog, and a first recap covering a single day quietly withholds the
thing the boss most likely missed. It is only ever the first run — every later
run starts from `last_seen_at`, which after a daily habit is a day.

Seven days forward because a recap that stops at tonight's calendar tells a boss
reading it on Monday nothing about Wednesday's board meeting, and "upcoming
meetings" was in the original ask precisely so it would. Both numbers belong to
`/api/recap` rather than to a prompt: the forward horizon is written onto the
request turn as `ahead_days` and asked for explicitly on every run, and the
backward floor is computed as `T0 - 7 days` when `last_seen_at` is NULL.

The header must state whichever window was actually used, which is why
`sinceFirst` interpolates a date rather than carrying "the last 7 days" as a
literal. The forward half is the same argument pointing the other way, twice
over: `recap.ahead` interpolates the horizon rather than spelling "7" into two
dictionaries, and it renders only when the run both **delegated** the calendar
and got `"ok"` back for it. If the constant ever changes, the copy stays true
without being touched; if the calendar was not read — or was never asked for —
the copy does not claim it was.

### Timezone — decided 2026-09-05

Every time a recap prints — the period header on this side, and "your 3pm
meeting" in the body — is rendered in the account's **`profiles.timezone`, which
is owner-controlled**: seeded once from the owner's calendar zone when a completed
owner recap reports one, and set by the owner in account settings otherwise. The
VPS timezone is never used, and must never be reached by omission. The failure
that names is real: a header formatted in the viewer's browser zone above a body
generated in the box's zone is one message disagreeing with itself about when a
meeting is.

**A correction first, because a previous draft of this section drew a wrong
inference and the same mistake is easy to repeat.** That draft read
`/api/health`'s `google:false` as evidence that the Google tier was unreachable
in this deployment, and hedged the whole section on it. **`google:false` does not
say that.**

Read the endpoint. The flag is
`Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI)` — three
environment variables, evaluated in the dashboard's own process, on Vercel. It is
a statement about **whether the dashboard has an OAuth client of its own**, and
about nothing else. It does not report whether a refresh token exists anywhere,
it does not report anything about the box, and a health endpoint structurally
cannot: a service reports what its own process can see.

What is actually true, confirmed against the box 2026-09-05: **Hermes' Google
Workspace MCP is connected and verified, with Gmail and Calendar tools including
`gmail_query_emails` and `calendar_get_events`.** So the reading of mail and
calendar that this feature needs is available *today*, through the box. These are
two different credentials reached by two different paths — the dashboard's own
browser OAuth flow in `src/lib/google.ts`, which writes a token onto a
co-located box's filesystem, and the MCP credential Hermes already holds — and
the first being unconfigured says nothing whatsoever about the second.

`/api/google/status` is likewise not the oracle it looks like. It is owner-only,
it reports what is on the **local filesystem** (`stat` against `credentialsDir`),
and a hosted dashboard runs on Vercel, whose filesystem is not the box's. On a co-located install it reports something real;
from the hosted dashboard it reports nothing about Hermes at all.

The rule to carry forward: **a health flag reports the service that serves it.**
Anything else is inference, and the inference was wrong here.

**That is why a calendar-derived zone is reachable at all — as a seed on the
reply, not as a tier the route resolves.** The dashboard cannot ask a calendar
anything: it has no Google client, and the box is *told* the zone rather than
asked for it. So there is no live calendar lookup in `/api/recap`, and
`profiles.timezone` is the authority rather than a fallback. The deployment
owner's decision of 2026-09-05 in full: `profiles.timezone` is **owner-controlled** — populated from
the owner's calendar timezone, once, when a completed owner recap reports one,
and otherwise set explicitly by the owner in account settings. **Never set by an
assistant, and never by email content.**

`/api/recap` resolves a zone before forwarding and **always sends an explicit
IANA name** on the request turn's `meta` — Hermes is never left to infer one,
which is the only way "never the VPS timezone" can be enforced rather than hoped
for. Resolution order: the caller's `profiles.timezone`; failing that, the
owner's `profiles.timezone`, because there is one office and an assistant should
read times the way the principal does; failing that, the zone the browser
resolved and sent with the trigger. That last tier is a display preference rather
than an authority, which is why it is safe to accept from a client in a way a
timestamp is not — and when it is used, the header names the zone via
`recap.timesIn`, so a wrong guess is visible rather than silent.

The header is then formatted **in that same zone**, by passing `timeZone` into
`toLocaleString` explicitly rather than letting it default to the browser's. The
zone the route resolved comes back with the window, so the header and the body
are formatted against the same value by construction. A header in the viewer's
laptop zone above a body in the account's zone is the bug this decision exists to
prevent, reintroduced by a missing option.

**Seeding from the calendar, and why the `coalesce` runs the other way now.** When
an owner's recap completes, the reply may name the zone it rendered in, and the
confirmation route writes `timezone = coalesce(timezone, <that zone>)`. An earlier
draft had this as `coalesce(<that zone>, timezone)` — the run's value winning
every time — and described it as self-healing. **Under an owner-controlled column
that direction is wrong**: it lets a run silently overwrite a zone the owner chose
by hand, which is precisely the thing "owner-controlled" forbids. Filling only a
NULL means the calendar seeds an empty column once, and after that the owner's
value stands until the owner changes it.

The cost of one column rather than two is honest and small: a seeded value is
indistinguishable from a chosen one, so an owner who moves and updates Google
Calendar keeps the old zone on the dashboard until he edits the field. A
`timezone_source` column would fix that and is **deliberately not built** — one
extra column and one extra branch to make a rare relocation automatic is not a
trade this feature needs.

Three guards on that seed, all of them because the value passes through a model:

- **Only on an owner's confirmation.** An assistant's run delegates nothing and
  has no calendar; if a reply on an assistant's confirmation names a zone at all,
  the route ignores it.
- **Validated as a zone before it is written**, by constructing
  `new Intl.DateTimeFormat("en", { timeZone: value })` in a `try`/`catch` and
  rejecting anything that throws. This is the right check specifically because it
  is *the same call the header formatter will make* — a value that passes
  validation cannot then crash the header, and a value that would crash the
  header never reaches the column.
- **It is a display preference, and it is not a capability.** A hostile email
  that persuaded a model to name a wrong zone would move times on a screen, in a
  way the owner can see and correct in one field. It reaches nothing else. See
  the injection section.

**Where the owner sets it: the Team page, under the Google account card.** That
page is already `Gate requireOwner`, and `GoogleConnect` is already the card that
explains what Dovis can read; the zone the recap renders in is the same
conversation, and its fallback story only makes sense next to the thing it falls
back from. It saves on change, the way the `allowModify` switch already does, so
it needs no Save button and no extra string. The widget is a small matter — a
native `<select>` over `Intl.supportedValuesOf("timeZone")` where the runtime
offers it, a plain text field otherwise — because the invariant lives in the
route, not the control: whatever reaches the server is validated there regardless
of what produced it.

**The route, and the RLS reality behind it.** `profiles` has **no client UPDATE
policy for a self-write**. `schema.sql` §4 has exactly one update policy —
`"owner updates"`, gated on `dovis_is_owner()` — which is being tightened above
to `and id <> auth.uid()` so the owner's browser cannot write its own row at all.
So this is a server route under `service_role` after `requireProfile()`, the same
shape `/api/auth/password-changed` uses:

```
POST /api/account/timezone
{ "timezone": "Asia/Taipei" }        // and optionally { "id": "<an assistant>" }
```

`requireProfile()`, then `auth.profile.role !== "owner"` → 403, then validate the
string, then `createAdmin().from("profiles").update({ timezone }).eq("id", target)`.
**An assistant is refused, unconditionally** — not because an assistant's own zone
would be dangerous, but because the column is one of the values a recap renders
times in, and the client's decision puts the whole column under the owner.

It is a **new route rather than a field on `/api/team/update`**, and the reason is
that route's own guarantee. `/api/team/update` refuses outright to touch a row
whose `role` is `owner` — *"The owner account cannot be paused or restricted."*
The timezone is the first setting that must be writable *on* the owner's row, so
folding it in would turn a one-line invariant into a per-field matrix, and that
invariant is worth more than the file it would save.

### The Hermes route, and why the recap wants its own — closed 2026-09-05

The deployment owner's constraint is that read-only must be structural — role, auth and tool
restrictions, not a prompt. That rules out running the recap on `owner-chat`,
because `owner-chat` is bound to `hermes-telegram`, which Hermes describes as the
*"full normal core toolset, including filesystem/terminal/memory/etc."* A recap
answered there is read-only only because it was asked nicely, which is precisely
the guarantee this architecture rejects everywhere else.

**This was the last of the original open questions, and Hermes answered it on
2026-09-05: a custom restricted toolset per webhook route is possible.** Not an
arbitrary toolset in the request body — that assumption was retracted earlier and
stays retracted — but a dedicated route whose toolset is composed for it. So the
recap gets a third route, with its own secret:

```yaml
routes:
  owner-recap:
    secret: "server-side-recap-secret"
    # Read tools only, from the Google Workspace MCP that is already connected
    # and verified on the box: gmail_query_emails, calendar_get_events.
    # No send, no draft, no filesystem, no terminal, no memory write, and no
    # outbound web fetch.
    toolsets: [ owner-recap-read ]
```

**Do not put `no_mcp` on this route.** The `no_mcp` restriction is what makes the
assistant route safe, and it is exactly wrong here: the Gmail and Calendar tools
this feature exists to use *are* MCP tools, served by the Google Workspace MCP.
Applying `no_mcp` to `owner-recap` would remove the only capability the route was
created to reach, and it would fail in the quiet way — a route that authenticates,
runs, answers, and reports `coverage: {mail: "unavailable"}` for ever. The
restriction that belongs here is tool-level, not MCP-level.

This is still **a change to the client's box, not something the dashboard does**: a
config edit, a third secret to store and rotate, a `HERMES_RECAP_SECRET` in
`.env.example` and in Vercel. It is grouped with the other Hermes asks at the
foot.

For the record on why neither existing route was reusable: `hermes-telegram` is
far too wide, and `hermes-webhook` has no mail or calendar read at all while
adding outbound web fetch, which is the one capability an injection-summarising
run should not have. The composed route takes the reads and leaves both.

**Be honest about what the route buys.** It is not a defence against an
adversary, because there is no escalation to defend against: the same owner
reaches the full toolset by typing anything else into the same chat window, and
Dovis reads the same mailbox on Telegram today. What it buys is that the *recap
run itself* structurally cannot act — which is exactly what the deployment owner asked for, and
which no prompt can deliver.

And the fallback that used to hang off this question — *if no read-only
composition can be built, ship the recap without mail or calendar* — is retired.
It is buildable. The delegated set for an owner is `["mail", "calendar"]`, and a
run that comes back blind on either is handled by coverage rather than by
shipping a smaller feature.

### What an assistant's recap can contain — decided 2026-09-05

**Assistants get no Gmail and no Calendar.** The deployment owner's instruction is that assistant
chat runs on a fixed restricted route with no Gmail, no Calendar, no write tools,
no memory, no terminal and no MCP — `hermes-webhook` under the `no_mcp`
restriction, which is the `assistant-chat` route the parent document already
describes. That is the direction the terms demanded: the box holds exactly one
Google credential, the owner's, so an assistant recap that read mail would be
reading the principal's mail with the principal's token, under the principal's
name, with no per-caller identity to scope it by.

So an assistant's recap is **the queue plus their own conversations, by
construction rather than by instruction**, and it runs on `assistant-chat` rather
than a fourth route. A recap-specific route beside it would buy nothing: the
existing toolset already has no mail, no calendar and no writes of any kind. The
read-only guarantee there comes from the route the assistant's ordinary chat
already uses, which is the strongest version of it available — one fewer secret,
one fewer thing to misconfigure.

**In envelope terms, an assistant's run delegates nothing:** `delegated: []` on
the request turn. Full coverage is therefore satisfied trivially, so an
assistant's marks advance normally, and `recap.ahead` can never render on their
recap — the render gate is the intersection of `delegated` and `coverage`, and an
empty `delegated` cannot contain `calendar` whatever the reply claims. Both of
those used to be rules somebody had to remember. They are now consequences.

**What that enumeration leaves out is outbound web fetch, which the route does
carry**, and it should not be read as "strictly narrower than anything". The
recap-route section above rejects `hermes-webhook` for the *owner's* recap partly
on that ground, and an assistant's recap is a summarising run over externally
influenced text too, since queue titles are derived from the principal's email, as
`schema.sql` says in as many words. It is accepted here for two reasons, and
neither is that the capability is absent: the deployment owner's instruction binds assistant
chat to this route, and an assistant already reaches exactly this toolset through
their ordinary chat, so the recap turn adds no reach they did not have a sentence
earlier.

**Note the toolset does not supply even the queue.** `hermes-webhook` has no
database read of any kind. So an assistant's queue delta and their own unanswered
turns have to be assembled by `/api/recap` under the caller's own identity and
forwarded as context, the same way the last N turns already are. The toolset is
what makes the recap unable to reach *further*; it is not what makes it able to
reach the queue. This is also why `queue` and `threads` are absent from
`RecapSource`: they never crossed the wire, so there is nothing for the box to
report about them.

**And that assembly is now permission-bearing, because `/api/payload/[id]`
changed on 2026-09-05.** What was an open question — is that route intentionally
role-blind? — has been answered by the code rather than by the deployment owner: it now requires
`permissionsFor(auth.profile).canModify` before returning a payload, with tests
in `tests/payload-route.test.ts` pinning the decision. An assistant without
`can_modify` can see that a queue item exists and read its title, and cannot read
the drafted body. **So `/api/recap` must assemble its queue delta from `todos`
alone, and never join `todo_payloads`.** A recap that pulled a draft's subject
and body into the context it forwards would route straight around the gate that
route has just installed, and it would do it in prose, where nothing checks it.
Titles and states only.

Scoping is otherwise free. `messages` and `conversations` select on
`author_id = auth.uid() or dovis_is_owner()`, so an assistant's own-thread half
is bounded by RLS. `todos` is readable by every active account — `read todos`
uses `dovis_is_active()` with no author dimension — so a queue delta of titles
and states discloses nothing an assistant cannot already see on screen.

**The copy must not promise mail it will never show.** A recap that prints an
"Email" heading with nothing under it asserts a quiet mailbox rather than an
absent capability. The assistant scope line describes the queue and their own
threads, and names nothing else.

### Injection from summarised mail

A recap reads text written by people outside the deployment and feeds it to a
model. That is genuine, and it is worth being precise about what contains it and
what does not.

**The toolset on the route the run executes on is the containment.** Nothing
else. Not a system prompt, not the rendering, not a note in the transcript. This
is the same argument that makes the no-send guarantee credible: `gmail_reply` is
absent from the allowlist and `GMAIL_ALLOW_SENDING` is unset, so the model cannot
send because the capability is not there.

**It is not a new exposure.** The owner's ordinary chat already reads the
mailbox on the full toolset, and so does Telegram. A read-only recap route bounds
the recap turn and nothing wider. It is worth having because the deployment owner asked for that
one turn to be structurally incapable of acting — not because it closes a door
that is otherwise open.

**The envelope is not a containment boundary either, and must not be read as
one.** `meta.result` and `meta.coverage` decide which sentence the dashboard
renders and whether a floor moves; they do not vouch for `content`. A conforming
envelope on a reply whose prose was shaped by a hostile email is still hostile
prose, rendered as escaped text. Validation gates the *marks*, not the *words*.

**`meta.timezone` is the one field on the envelope that writes to the database,
so it gets its own sentence.** It is validated as a constructible IANA zone, it
is accepted only on an owner's confirmation, it can only ever fill a NULL column,
and the worst it can do when all of that is satisfied is render times in the
wrong zone on a screen where the owner can see it and fix it in one field. It
reaches nothing else, and no other field on the envelope is written anywhere.

On rendering, the honest position is that the repo is already correct and should
stay that way. There is no markdown renderer, no sanitizer and no linkifier in
`package.json`, and `queue.tsx` already prints the most attacker-adjacent strings
in the product — `to`, `subject` and the full `body` of a drafted email — as
escaped JSX under `whitespace-pre-wrap`. The recap renders the same way. No HTML,
no remote images, no auto-linking.

**No action controls inside a recap.** Decisions stay in the queue, where the
owner reads the actual payload before confirming. That is a rule about where
consequence lives, not a defence against a particular attack.

### What the recap can truthfully say about the queue

`todos` carries three timestamps: `created_at`, `confirmed_at`, `completed_at`.
There is no `updated_at`, and `/api/act` writes no timestamp at all for reject or
modify — the patches are literally `{ status: "rejected" }` and
`{ status: "modifying" }`. The executor sets `failed` and `executing` with no
timestamp either.

So the queue half of a recap has two halves of its own.

**Windowed, against the floor:** genuinely new proposals (`created_at`),
approvals (`confirmed_at`), completions (`completed_at`).

**Unconditional, by current state, regardless of the window:** open `proposed`
items, `modifying` items, `failed` items, rows sitting in `executing` long after
a run should have finished, open items carrying `priority = 'high'`, and the next
seven days of meetings. These are reported every time until they are dealt with.
Time-windowing a failure would make a real, unaddressed failure vanish from the
second recap, which is worse than repeating it.

**That repetition is a deliberate product behaviour, not a mitigation.** It means
the boss reads the same unresolved failure every morning until he acts on it.
That is the intent — an unaddressed failure that stops being mentioned has been
hidden, not resolved — but it is the kind of thing that reads as a bug on day
three, so it is stated here rather than buried in a table. It is also why the
full-coverage floor is affordable: the material a blocked floor repeats is
material this half already repeats on purpose.

**Decided 2026-09-05: there is no global "I'm caught up, stop telling me"
control.** A dismiss button would be a second writer with different semantics —
*I have read this* is not *this is resolved* — and one button that silences a real
failure is the exact opposite of what the unconditional half exists for.
Successful recap generation moves `last_seen_at`, and nothing else does. A
per-category snooze may be considered later; if it is, it needs columns of its
own, because a mark meaning *reported* and a mark meaning *muted* must never be
the same number.

**`todos.priority` is where "anything urgent" comes from, and it already
exists.** `schema.sql` declares
`priority text default 'normal' check (priority in ('low','normal','high'))`,
`types.ts` types it, and `queue.tsx` already renders a red `· priority` marker
for `high` — so urgency is a first-class field in this product, and a recap that
reports a high-priority proposal indistinguishably from a normal one silently
drops the last item the opening paragraph promised. Report open `high` items as
their own line rather than folded into the ordinary `proposed` list, and report
them unconditionally, for the same reason failures are unconditional: an
unaddressed urgent item that stops being mentioned has been hidden. No migration
is needed; the column is there.

**Upcoming meetings are forward-looking and cannot be a delta**, which is why
they sit in the unconditional half with the fixed seven-day horizon decided
above. A recap run five minutes after the last one has no calendar *changes* and
must still say what is coming. The route asks for that horizon explicitly on
every run. The separation between *what changed* and *what is coming* is Dovis's
to make in its own prose: the envelope says whether the run completed and what it
could see, not how it organised its paragraphs, and this design should not
pretend otherwise.

**Rejections and modifications currently fall through both halves, and that is a
real gap.** A rejection is a decision — arguably the most informative one in this
product, per `rejectPrompt`: *"Dovis learns more from this than from a
confirmation."* It has no timestamp, so it cannot be windowed; and it is
terminal, so putting it in the unconditional list would replay every rejection
the boss has ever made, for ever. Neither list can hold it.

**Recommendation: one column, written by the decision path only.**

```sql
alter table public.todos
  add column if not exists decided_at timestamptz;

comment on column public.todos.decided_at is
  'Set by /api/act when an item is rejected or sent back for modification — the '
  'sibling of confirmed_at for the two decisions that recorded no time at all. '
  'Written ONLY on the decision path, never by the executor, which is why this '
  'is not an updated_at: an executing claim must not look like a decision.';
```

This is the reason the earlier draft was right to reject a generic
`todos.updated_at` and wrong to stop there. A `before update` trigger fires on
the executor's `executing` claim, which the schema documents as bookkeeping set
*before* acting, so every executor pass would inject a "changed since your last
review" row with no decision attached — and a `not null default now()` backfill
would stamp every pre-existing row with the migration time, so the first recap
after deploy reports the entire queue as changed. `decided_at` has neither
problem: `/api/act` writes it in the same patch it already sends, and old rows
stay NULL, which is correct — they were decided before this feature existed and
should not be reported as news.

**`todos.created_at` is nullable, and this feature is the first thing to depend
on it.** `schema.sql` declares `created_at timestamptz default now()` with no
`not null`, while `types.ts` declares it non-null. A row with a NULL `created_at`
fails `created_at > $1` silently and is invisible to every recap for ever. Fix
the column rather than working around it with a `coalesce`, since fixing it also
makes `types.ts` true:

```sql
-- If this UPDATE touches any row, that row's real creation time is already lost.
-- Review before running; do not run it blind.
update public.todos set created_at = now() where created_at is null;
alter table public.todos alter column created_at set not null;
```

**`todos` records no actor.** Nothing writes who pressed Confirm, and an
assistant with `can_modify` uses the same route. The recap can say *"three things
were approved"*. It cannot say *"you approved three things"*. If attribution is
wanted, that is an actor column and a separate decision, and it is deliberately
not folded into this work.

### Unresolved conversations — decided 2026-09-05

**Definition: a conversation whose most recent `messages` row has
`role = 'user'` and is older than ten minutes.** The boss asked something and
Dovis never answered — a crashed run, a lost webhook, a reply that failed to
insert. The ten minutes exclude a turn that is simply still in flight. It is a
narrow definition on purpose: any looser one ("a thread that trailed off") is
unfalsifiable, and every finished conversation ends with a `dovis` row, so
without the role test the predicate matches nothing or everything.

**The owner's recap does not include assistants' unfinished conversations.**
The deployment owner's answer is no. RLS would permit it — the owner can read every assistant's
conversations — so this is a deliberate narrowing in the query rather than
something the database prevents: `author_id = <the caller>` on every account, the
owner's included. The parent document's own reasoning is why. An assistant is
told they are visible precisely because surprise visibility is a trap, and
*auditable on inspection* is a materially different arrangement from *pushed into
the principal's daily briefing*. Assistants' conversations stay reachable exactly
where they already are: the collapsed **Assistants** folder in the owner's
conversation list, which the owner opens deliberately.

Because this is a query narrowing rather than a policy, it is the kind of rule
that regresses quietly — a later "why not show everything the owner can read?"
would look like a simplification. The check is one line of test and it belongs
with the route: an owner whose assistant has an unanswered turn gets a recap that
does not mention it.

### UI states, and the strings

The recap is a chat turn, so most of what the reader sees is a `messages` row
Hermes wrote. The dashboard owns the trigger, the period header, the two empty
messages, and the states where no reply exists yet. Every "delivered" row below
is driven by the verdict `/api/recap/seen` returned — never by the browser
reading `meta` for itself.

| State | What is on screen |
|---|---|
| Idle, never run | The quick action in the chat's action row, plus `recap.neverRun`. Chosen by **the recap conversation holding no `dovis` reply at all** — *not* by `last_scan_at === null`, which since the full-coverage gate also describes a first recap that came back partly blind. Not in the Danger zone, not in the header. |
| Idle, run before | The quick action, plus `recap.sinceDate` with `last_seen_at`. |
| Idle, a reply exists but no mark ever advanced | The quick action alone; the slot beside it renders nothing. The reply's own `recap.partial` or `recap.runFailed` already says what happened, and neither `recap.neverRun` nor a `since` date would be true. |
| Working | The user's turn is in the thread; a pending Dovis bubble with `recap.working`. The trigger is `disabled` while in flight, matching `queue.tsx` and `refresh-control.tsx`. |
| Delivered — success | An ordinary Dovis bubble rendering `content`, with `recap.sinceDate` (or `recap.sinceFirst`) above it — and `recap.ahead` **only when `calendar` is in the verdict's `covered`**, which means the run both delegated it and got `"ok"` back. Requires a verdict of `advance`. Both marks advanced. |
| Delivered — empty | `recap.nothingNew`, interpolating the `last_scan_at` the confirmation route just returned. Rendered from the verdict, not from `content`, and only on `advance`. Both marks advanced. |
| Delivered — partial | The prose renders, with `recap.partial` naming the verdict's `blind` sources and **no period header** — the run cannot be shown to have covered the period it was given. **`recap.ahead` does not render either**, even when the calendar was the source that *did* read: it is an extension of the period header, and there is no header for it to extend. The calendar material is in the prose regardless. **Neither mark advanced**, and the next recap re-covers the period. `recap.partialSince` replaces `recap.partial` once `blind_since` shows the source dark for 24 hours or more, and `recap.partialRepeated` joins it beneath at three blind runs in a row — both are changes of volume, and neither changes what advanced, which is nothing. |
| Delivered — error | `recap.runFailed` plus `recap.retry`. Covers both `result: "error"` and a reply whose envelope failed validation, which look identical to the boss and differ only in the server log. The prose still renders; the period header and `recap.ahead` do not. **Neither mark advanced.** Never either empty message. |
| No reply yet | After **90 seconds**, refetch the thread once. If still nothing: `recap.noReplyYet` plus `recap.checkAgain`. Neither mark has moved. |
| Failed to send | The POST itself failed — auth, HMAC timestamp outside ±300s, box unreachable, or the route's own queue assembly failed before forwarding. `recap.failed` plus `recap.retry`. Nothing was read and nothing was marked. |
| Backend not configured | `/api/recap` answers 503 with `reason: "hermes-unconfigured"`, and only that reason renders `recap.unavailable`. |
| Demo | The trigger is visible and works, and everything it produces is labelled a sample. See "Demo mode" below. |

**90 seconds, and why that number.** The HMAC timestamp window is ±300 seconds,
so a run that has produced nothing well inside that is either slow or dead and
the UI cannot tell which; and a mail-and-calendar summarisation on 4GB / 2 vCPU
is tens of seconds, not seconds. It is a **UI timeout only**: no mark advances on
a timeout, and a reply that lands at 200 seconds still arrives over Realtime,
still gets confirmed, and still advances the marks when it does — and if the
socket was down for all of it, the reconciliation on the next thread load
confirms it instead.

**The two empty messages are what the second column is for, and they are
sentences the dashboard is entitled to say.** An earlier draft recommended against
a client-rendered empty state, on the grounds that "nothing changed since your
last review" is a claim only a run that actually looked can make, and the
dashboard could not tell *looked and found nothing* from *never looked*. **The
deployment owner answered that on 2026-09-05: support the empty state, and distinguish the two.**
The envelope is what makes it honest rather than a guess — `result === "empty"`
on a verdict of `advance` is a run reporting that it looked at everything it was
asked to look at, so `recap.nothingNew` restates something the run said instead
of inventing it. And `recap.neverRun` is chosen from the absence of any reply in
the recap conversation, which is a fact about this account's history rather than
a claim about a mailbox — and which, unlike `last_scan_at === null`, cannot be
produced by a run that merely went blind. The failure the old recommendation
feared is impossible in the direction that mattered: **an errored, malformed or
partially blind run renders `recap.runFailed` or `recap.partial`, never
`recap.nothingNew`**, because that sentence is gated on a verdict none of them
can produce.

**The "backend not configured" state needs something to detect, and today there
is nothing.** `isDemoMode` in `src/lib/config.ts` is `!SUPABASE_URL ||
!SUPABASE_ANON_KEY` — a statement about Supabase only. A real deployment with
Supabase configured and no Hermes environment is neither demo nor working, and
`.env.example` declares no Hermes variables at all. Two changes, and the first
belongs to the chat PR rather than this one: declare `HERMES_WEBHOOK_URL` and the
per-route secrets in `.env.example`, and add a `hermes` boolean to `/api/health`
alongside `demo`, `supabase`, `serviceRole` and `google` — that file's own
comment already argues this exact case ("Supabase configured but no service_role
is the nastiest half-state"). Note what that flag will and will not mean, since
this section has just spent a page on the same mistake: `hermes:true` says this
deployment holds a webhook URL and secrets, not that the box is up or that its
Google credential works. The UI, meanwhile, should not fetch `/api/health` to
decide what to render; it distinguishes *unavailable* from *failed* by the
response `/api/recap` gives it, which is the only source that actually knows.

```ts
recap: {
  quickAction: "Catch me up",
  triggerAria:      "Catch me up on everything since your last review, {when}",
  triggerAriaFirst: "Catch me up on everything since {when} — no previous review",
  // Match input ONLY, never rendered: already normalised (lower-case, no
  // trailing punctuation) so the equality test is a plain comparison. Do not
  // "fix" the casing — that silently breaks typed triggering.
  triggers:     ["catch me up", "what did i miss"],
  sinceDate:    "Since your last review — {when}",
  sinceFirst:   "No previous review — since {when}",
  // Rendered only when `calendar` is in the verdict's `covered` — delegated AND
  // reported ok — which is never for an assistant, and never without a header.
  ahead:        "Plus anything scheduled in the next {days} days",
  working:      "Dovis is catching you up",
  nothingNew:   "Checked {when} — nothing new.",
  neverRun:     "No recap has been generated yet.",
  runFailed:    "Dovis couldn't finish this recap, so nothing has been marked as reviewed.",
  // {sources} is built from `sources` below, joined with `sourceJoin`.
  partial:      "Dovis couldn't read {sources} this time, so nothing has been marked as reviewed.",
  // Replaces `partial` once blind_since shows the source dark for 24 hours or
  // more. {when} is that recorded instant — the first run that FOUND it dark,
  // never a claim about when access was actually lost.
  // WHEN {sources} NAMES MORE THAN ONE SOURCE there is still only one {when},
  // and the keys were written on different runs, so interpolate the MOST RECENT
  // instant among the named keys and never the earliest: mail dark since Monday
  // and the calendar since Wednesday renders "since Wednesday", which
  // under-claims mail's outage by two days rather than over-claiming the
  // calendar's — the same safe direction as the rest of this section.
  partialSince: "Dovis hasn't been able to read {sources} since {when}. This recap may be incomplete, and nothing has been marked as reviewed.",
  // A second line beneath partialSince at three or more blind runs in a row. No
  // count is interpolated: the gate has proved "three or more" and nothing else.
  partialRepeated: "Three or more recaps in a row have come back incomplete. Reconnect Google on the Team page — until then every recap covers a widening period.",
  sources:      { mail: "your mail", calendar: "your calendar" },
  sourceJoin:   " and ",
  noReplyYet:   "No reply yet. The run may still be going.",
  checkAgain:   "Check again",
  failed:       "Couldn't reach Dovis. Nothing was read and nothing was marked.",
  retry:        "Try again",
  unavailable:  "Catch me up needs a Dovis box, and this deployment has none configured.",
  sampleTag:    "Sample",
  sampleHeader: "Sample recap — invented, and covering no real period",
  timesIn:      "Times shown in {zone}",
},
```

```ts
recap: {
  quickAction: "補進度",
  triggerAria:      "整理自上次檢視（{when}）以來的所有變動",
  triggerAriaFirst: "整理自 {when} 以來的所有變動（沒有上次檢視紀錄）",
  // 僅供比對，不會顯示：已正規化（小寫、去除結尾標點）。
  triggers:     ["補進度", "幫我補進度", "我錯過了什麼", "有什麼我漏掉的"],
  sinceDate:    "自上次檢視以來——{when}",
  sinceFirst:   "沒有上次檢視紀錄——自 {when} 起",
  // 只有 calendar 同時被委派且回報 ok 時才顯示；助理的整理永遠不顯示，
  // 沒有期間標題時也不顯示。
  ahead:        "另外加上未來 {days} 天的行程",
  working:      "Dovis 正在幫你整理",
  nothingNew:   "已在 {when} 檢查過，沒有新的變動。",
  neverRun:     "還沒有產生過任何進度整理。",
  runFailed:    "Dovis 沒能完成這次整理，進度標記維持不變。",
  partial:      "Dovis 這次讀不到{sources}，進度標記維持不變。",
  // blind_since 顯示該來源已中斷 24 小時以上時，改用這一句。
  // {when} 是「第一次發現讀不到」的時間，不宣稱存取是何時失效的。
  // {sources} 同時列出多個來源時，{when} 只有一個：一律取這幾個 key 之中「最晚」
  // 的那個時間，絕不取最早的。各來源是在不同次執行才被記錄的，寧可少算中斷時間，
  // 也不要幫其中一個來源誇大。
  partialSince: "Dovis 從 {when} 起就讀不到{sources}。這次整理可能不完整，進度標記維持不變。",
  // 連續三次以上讀不到時，接在 partialSince 下面另起一行；不帶入次數。
  partialRepeated: "已經連續三次以上的整理都不完整。請到團隊頁面重新連結 Google；在那之前，每次整理涵蓋的期間都會愈拉愈長。",
  sources:      { mail: "你的郵件", calendar: "你的行事曆" },
  sourceJoin:   "與",
  noReplyYet:   "還沒有回覆，執行可能還在進行中。",
  checkAgain:   "再看一次",
  failed:       "無法連線到 Dovis。沒有讀取任何內容，也沒有更新進度標記。",
  retry:        "重試",
  unavailable:  "補進度需要連上 Dovis 主機，這個部署尚未設定。",
  sampleTag:    "範例",
  sampleHeader: "範例進度整理——內容是虛構的，不對應任何實際期間",
  timesIn:      "時間以 {zone} 顯示",
},
```

Five more keys sit at the top level beside `googleTitle`, because they belong to
the Team page rather than to the chat:

```ts
timezoneTitle:   "Time zone",
timezoneHint:    "Every time in a recap is shown in this zone. Dovis fills it in from your Google Calendar the first time it reads one — set it here if you would rather choose.",
timezoneInvalid: "That is not a time zone Dovis recognises.",
// The Google card's persistent warning, from 24 hours dark onward. {sources} is
// built from t.recap.sources and t.recap.sourceJoin — one vocabulary for the
// sources, wherever they are named. Same {when} rule as recap.partialSince: with
// more than one source named, interpolate the MOST RECENT instant among the
// named blind_since keys, never the earliest. The second clause — "Every recap
// since then has been incomplete" — inherits that instant, so the earliest key
// would over-claim this sentence twice over.
googleBlindWarning: "Dovis has not been able to read {sources} since {when}. Every recap since then has been incomplete, and nothing has been marked as reviewed.",
// Added beneath it at 72 hours dark or more, with the Danger zone's destructive
// treatment. {days} is computed from blind_since at render — the card has no
// conversation to walk, so it escalates on time where the chat escalates on runs.
googleBlindStale:   "Still unavailable after {days} days.",
```

```ts
timezoneTitle:   "時區",
timezoneHint:    "進度整理中的所有時間都以這個時區顯示。Dovis 第一次讀到你的 Google 行事曆時會自動填入——你也可以在這裡自己指定。",
timezoneInvalid: "這不是 Dovis 能辨識的時區。",
// 與 recap.partialSince 相同的 {when} 規則：{sources} 列出多個來源時，
// 取這幾個 key 之中「最晚」的那個時間，絕不取最早的；後半句「在那之後的每次
// 進度整理都不完整」也是以同一個時間為準。
googleBlindWarning: "Dovis 從 {when} 起就讀不到{sources}。在那之後的每次進度整理都不完整，進度標記也維持不變。",
googleBlindStale:   "已經持續 {days} 天讀不到。",
```

**The card borrows `t.recap.sources` and `t.recap.sourceJoin` rather than
carrying its own nouns.** 「你的郵件」 has to read the same on the Google card as
it does inside a recap, because the two sentences are about the same failure and
a boss comparing them should not have to wonder whether they mean the same
thing — and one vocabulary is also one place for a translator to change it.

**`sourceJoin` rather than `Intl.ListFormat`.** The list never exceeds two items
today and would never exceed a handful, and a list formatter's conjunction and
separator differ per locale in ways that would need verifying in both languages
to make one comma right. A dictionary string keeps both languages under the
translator's control and cannot surprise anyone in production.

**The trigger phrases are dictionary keys, not English literals, and that is the
point.** An earlier draft matched two hard-coded English strings, which means a
繁中 boss typing 「補進度」 falls through to the ordinary route, gets the wide
toolset, gets no period header, and the read-only guarantee silently does not
apply to the entire Chinese half of the product by default. The matcher tests the
normalised turn against the union of every language's list, not just the viewer's
current one, because the toggle is per-viewer and a boss who switches to English
mid-session should not lose his Chinese phrases.

Six register decisions against the shipped dictionary. `quickAction` is
「補進度」, three characters, because every other action label is two to four
(`確認` / `修改` / `退回` / `重新整理` / `顯示`) and the earlier 「幫我補進度」 is
a seven-character sentence that will not sit in a row beside them — it survives
as a *typed* trigger, where sentence length is natural. 「檢視」 replaces
「查看」 for the boss's review, matching `readOnlyHint`: 「你的帳號可以檢視佇列」.
**「檢查」 is used for the machine's scan and 「檢視」 for the boss's review, and
the split is deliberate**, mirroring the English "checked" against "review":
「已在 {when} 檢查過」 is Dovis reporting that it looked, which is a different act
from the boss having read the result — and the two marks behind those two
sentences are different columns. 「執行可能還在進行中」 replaces
「工作可能還在進行」, since 工作 for a model run reads as generic "work" rather
than the ordinary Taiwan technical register. And `sampleTag` is 「範例」 rather
than 「示範」, because 示範 already labels the whole deployment in `demoBanner`
(「示範資料」); 範例 labels this one artefact inside it, and a reader has to be
able to tell those two apart at a glance. And `partialRepeated` says
「重新連結 Google」 using `googleReconnect`'s exact word rather than
「重新綁定」, because the sentence is telling the boss to press that specific
button and the words in the instruction should be the words on the control.

**`partial` and `partialSince` both reuse `runFailed`'s second clause on
purpose**, in both languages. The boss is being told the same operational fact —
nothing was marked, the period will come round again — and only the reason and
the duration differ. Two different phrasings for one consequence would invite him
to think the consequences differ, and the escalation must not read as though the
floor behaves differently once the warning gets louder. It does not.

**`unavailable` changed in both languages, and the old copy must not survive.**
It used to read "It does nothing on the demo" / 「示範站台不會有」, which is now
false: demo mode renders a labelled sample. The string's actual job is the
half-state — a real deployment, a real database, no Hermes configured — so it
names the deployment rather than the demo.

Nested under `recap` to match `t.status.*` and `t.action.*`. The
`export const languages: Record<Lang, Dict> = dict` assertion at the foot of
`i18n.ts` covers nested shape, so a key added to `en` and forgotten in `zh-TW`
fails the build rather than rendering `undefined` mid-sentence — which is exactly
the behaviour wanted for `triggerAriaFirst`, `ahead`, `nothingNew`, `neverRun`,
`runFailed`, `partial`, `partialSince`, `partialRepeated`, `sources`,
`sourceJoin`, `sampleTag`, `sampleHeader`, `timesIn` and the five Team-page keys,
all of which must land in both dictionaries or in neither. The assertion does **not** check that `triggers` is
non-empty — `string[]` satisfies the type when empty — so one unit test asserting
every language's `triggers[0]` exists is worth the three lines, since an empty
array silently disables typed triggering for that language and nothing else would
notice.

`{when}`, `{zone}`, `{days}` and `{sources}` interpolate with
`.replace("{when}", …)`, the same idiom `{n}` already uses in `waitingHeadline`.
Both first-run and returning copy take the same slot on purpose: whatever the
first window is set to, the header states the window that was actually used and
cannot claim a period the run did not cover.

Format with **`toLocaleString`**, not `toLocaleDateString`. `page.tsx` uses
`toLocaleDateString(lang === "en" ? "en-GB" : "zh-TW", { weekday, day, month })`
— locale choice and field style to copy, but it passes no time fields at all, so
it demonstrates nothing about formatting a time through that call. Time options
do happen to survive `toLocaleDateString`, but only through an ECMA-402 corner,
and it reads as a mistake to the next maintainer. Use the right call, keep the
`en-GB` / `zh-TW` choice (which gives "3 September" rather than "September 3"),
add `hourCycle: "h23"` so zh-TW renders 09:20 rather than 上午09:20, **pass
`timeZone` explicitly** per the timezone decision above, and **include the year
unconditionally**. The mark can be months old on a box that has been running a
while, and a conditional year is a branch that is wrong for eleven months of
testing and right in the twelfth.

One honest gap: the chrome follows the viewer's toggle, but the recap **body**
comes from Hermes, whose default language is set on the box. A 繁中 viewer can
get Chinese headings around English prose. The three dashboard-rendered outcomes —
`empty`, `partial` and `error` — escape this entirely, because they are dictionary
strings rather than model output; only `success` carries the risk.

**Decided 2026-09-05: `/api/recap` sends the language as a prompt hint.** The deployment
owner's words: the server must derive the language from the authenticated dashboard
preference, not trust arbitrary request data, and the structured response envelope
stays language-independent and must still be validated as `success | empty |
partial | error`. The hint selects a prompt, not a toolset, so the route binding
is untouched; it rides on the request turn's `meta` as `lang`, beside `timezone`,
for the same reason — a value the run was *given* is recorded by the side that
gave it.

**The envelope does not move with it, and that is a rule rather than an
observation.** `kind`, `result` and `coverage` are ASCII literals in every
language, and a `result: "成功"` is `malformed`. Localising the envelope would
turn `verifyRecapReply` into a translation table and hand the box a second way to
be misread; the prose is the only thing the hint may change.

**VERIFIED FINDING: there is no authenticated dashboard language preference to
derive from.** Language lives entirely in the browser. `LANG_STORAGE_KEY` is
`"dovis.lang"` in `src/lib/i18n.ts`, and `ThemeProvider` in
`src/components/theme-provider.tsx` reads it from `window.localStorage` on mount
and writes it back in `setLang`. Nothing sends it anywhere. And `profiles` has no
`lang` column: its columns are `id`, `email`, `username`, `display_name`, `role`,
`status`, `can_modify`, `must_change_password`, `created_at` and
`last_sign_in_at`. **So the server cannot today derive what the deployment owner
asked it to derive**, and this has to be said before anything is built rather than discovered
by an implementer reaching for a column that is not there.

**Recommendation: add `profiles.lang`, on exactly the pattern the deployment
owner chose for the timezone the same day.** A server route under `service_role` after
`requireProfile()`, seeded from the browser toggle the first time an authenticated
viewer sets one, and thereafter the source of truth that `/api/recap` reads:

```sql
-- PENDING THE DEPLOYMENT OWNER'S DECISION. Not part of the migration list at the
-- foot until they say so; recorded here so the shape is not invented later under
-- time pressure.
alter table public.profiles
  add column if not exists lang text
  check (lang in ('en','zh-TW'));

comment on column public.profiles.lang is
  'The account holder''s own display language, and the prompt hint /api/recap '
  'sends. SELF-SET, unlike timezone, which is owner-controlled: an assistant who '
  'reads Chinese must not be forced into the owner''s English. Written only by '
  'the account route under service_role after requireProfile(), seeded once from '
  'the browser toggle. NULL means nobody has chosen, and the route falls back to '
  'the validated enum on the request. The CHECK is the whole guarantee: a column '
  'that can only ever hold one of two literals cannot carry a prompt.';
```

**One deliberate divergence from the timezone, stated because the two routes will
sit beside each other and look copy-pasteable.** `/api/account/timezone` refuses
an assistant unconditionally, because the zone every recap renders times in
belongs to the account. Language is the opposite: it is a property of the reader,
not of the account, and an assistant forced into the principal's language would be
a worse product for no security gain. So the language route accepts a self-write
from any active profile and an owner write against any row, and it is the one
place in this design where those two differ.

**The incidental benefit, stated honestly because it is not what the deployment
owner asked for.** Today a boss's language does not follow him between devices. It is one
browser's `localStorage` key, so the same account opened on his phone comes up in
English and he sets it again. A column fixes that, and that is a real improvement
— but it is an improvement arriving on the back of a prompt hint, which is
precisely the kind of scope drift this document is supposed to name rather than
smuggle.

**The cost, equally honestly.** The existing toggle stops being a pure local
preference and starts writing to the server: a network call, a failure path when
that call fails, and two open tabs able to disagree until one reloads. The
`localStorage` key stays as the first-paint source — the toggle must not wait on a
fetch to render the right language on the first frame — with the column read at
bootstrap and winning where the two differ. That is a second writer for one value,
which is a small piece of real complexity in exchange for a hint. And it inherits
the tightening above: with `and id <> auth.uid()` on `"owner updates"`, even the
owner writes this through the route rather than through PostgREST.

**The fair alternative, which needs no migration.** `/api/recap` accepts `lang`
from the request body and validates it as exactly `'en' | 'zh-TW'`, rejecting
anything else. That is a *claim* rather than a *record*, which is the distinction
this document makes everywhere — but once the enum is enforced it is not
*arbitrary* data, and the blast radius is one prompt hint on the caller's own
recap. The worst a hostile or buggy client achieves is prose in the other
language on its own screen. It is the same reasoning that already accepts the
browser's zone as the last tier of the timezone ladder: a display preference is
safe to take from a client in a way a timestamp is not.

**THE DEPLOYMENT OWNER'S DECISION, still pending.** It is theirs because it widens
what they asked for: they asked for a prompt hint and the honest way to give them
one is a schema change, a route, and a toggle that talks to the server. It also edits a line
already in this document's out-of-scope list — *"Default language is set by
Hermes, not chosen in the dashboard. The existing EN / zh-TW toggle stays a
per-viewer override"* — and a per-viewer override that persists per account is no
longer only a per-viewer override. **Recommendation is the column**, because
"derive from the authenticated preference" is what they actually said and the
validated enum is a knowing second-best. Until they choose, `/api/recap` resolves
the hint the way the timezone resolves: `profiles.lang` if the column exists and
is set, otherwise the validated enum from the request, otherwise `en`.

### Accessibility

Explicit in the deployment owner's ask. The repo already sets every pattern needed, so this is
matching, not inventing.

**The tail of the thread is a live region, it is only the tail, and it is mounted
before there is anything in it.** The recap's tail slot carries `role="status"` —
which implies `aria-live="polite"` without spelling it out, and is the idiom
`StaleBanner` already uses and a maintainer will recognise. Copy the attribute,
but not `StaleBanner`'s mount behaviour: it early-returns null
(`if (pendingCount === 0 && !degraded) return null;`), so its region enters the
DOM already holding its text, and a live region registered together with its
content commonly announces nothing at all. The recap slot renders empty on thread
load and is never conditionally returned, so the pending bubble and whatever
replaces it are both *mutations inside an already-registered region*, which is
the thing that actually gets announced.

That matters twice over, because the outcome is the whole point. If the Dovis
reply renders in the transcript proper for layout reasons rather than inside the
slot, then the pending bubble's *removal* is all that happens to the region — and
removal is not announced under the default `aria-relevant="additions text"`, so
the asynchronous arrival this subsection exists to handle reaches nobody. Either
keep the outcome inside the persistent slot, or keep the slot and write a short
announcement into it when the run resolves.

**All five outcomes must announce, not only the successful one.** `success`
announces `recap.sinceDate` or the reply's first line; `empty` announces
`recap.nothingNew`; `partial` announces whichever of `recap.partial` and
`recap.partialSince` is on screen **with the blind sources named**, followed by
`recap.partialRepeated` when the escalation is in force — the escalation is
carried by wording as well as by treatment, which is why the louder state is a
different string rather than only a redder box, and which is what lets it reach
the audio channel at all; `error` announces `recap.runFailed`; the 90-second
timeout announces `recap.noReplyYet`. A screen-reader user who hears nothing after an errored or
partly blind run is left in the worst state this feature can produce — believing
a complete recap arrived — which is the same conflation the deployment owner's decision forbids
on screen, arriving through the audio channel instead. `partial` is the one most
likely to be forgotten, because it looks successful: prose arrives, the bubble
fills, and only the missing header says otherwise, and a header is not an
announcement.

The region is the tail slot alone rather than the whole transcript — but not for
the reason the earlier draft gave. Content present when a region is registered is
not announced, so a live transcript would not "read every historical message
aloud on mount". The real cost is that every *later* mutation of the transcript —
pagination, a refetch, an ordinary re-render — would be announced.

**The trigger's accessible name is a full sentence, its visible label is a
word.** `RefreshButton` already does this — `aria-label={label}` carries
"Reconnecting — this may be out of date" while the visible text stays "Refresh".
So the recap trigger renders `recap.quickAction` and carries `recap.triggerAria`
with the period interpolated: "Catch me up on everything since your last review,
5 September 2026, 09:20". That is a real string in both dictionaries above, not a
repetition of the visible label.

**And it has a first-run twin, selected by the same test as the header.**
`recap.triggerAriaFirst` is used whenever `last_seen_at` is NULL — the same NULL
test that chooses `sinceFirst` over `sinceDate`. Without it, the first run
announces "since your last review" while the header directly beside it reads "No
previous review", and the accessible name asserts a review that never happened;
the zh-TW string has the identical fault, naming 上次檢視 in the case where there
isn't one. It matters most on a narrow screen: the visible label is
`hidden sm:inline`, so at 375 the aria string is the only name a screen-reader
user gets.

**`aria-busy` goes on the trigger, not on the live region.** `aria-busy="true"`
instructs assistive technology to suppress announcements for the element it sits
on until it clears, so putting it on the `role="status"` slot swallows the
arrival exactly as if there were no live region — and it will, if the busy flag
and the inserted message come from separate state updates or separate render
passes, which is the ordinary case. The region is the announcer and is never
marked busy. Put `aria-busy` on the trigger, alongside the `disabled` it already
gets. If it is ever wanted on the region itself, the constraint is that it must
go false in the *same* render commit that inserts the outcome — both derived from
one piece of state — and that is a constraint worth avoiding rather than
documenting.

**Do not move focus when the reply lands.** It is the obvious wrong thing: the
boss may be typing the next question, and stealing the caret to announce an
arrival is worse than the arrival going unannounced. The live region is the
notification; focus stays where the reader put it.

The pending bubble uses **`.animate-working`** — the class `queue.tsx` already
puts on an `executing` row, which is the same claim ("a run is in flight on the
box") and should not acquire a second visual vocabulary here. Its reduced-motion
guard lives in `globals.css` beside the keyframes rather than in a utility, so no
`motion-reduce:` class is needed. `motion-reduce:animate-none` is the spinner
idiom from `refresh-control.tsx` and belongs to short local fetches; use it on
this surface only if a spinner actually appears on it. The ported `AssistantIcon`
already honours `prefers-reduced-motion` per the parent document.

**The period header is text in the DOM, not a `title` attribute.** It is the
claim about what the recap covers, so it must be readable by everything that
reads the page, not only by a hovering mouse. The same rule governs
`recap.sampleTag` and `recap.partial`, for the same reason and with more at
stake: those two are the lines that stop a reader believing something untrue.

The timezone control on the Team page is an ordinary labelled form field —
`timezoneTitle` as its `<label>`, `timezoneHint` associated through
`aria-describedby`, and `timezoneInvalid` announced on rejection rather than
rendered silently beside the field.

### Responsive, theme, and how it is verified

The trigger sits in the chat's action row and follows the shipped split: the
visible label may hide below `sm` the way `RefreshButton`'s does
(`hidden sm:inline`), because the `aria-label` carries the full sentence
regardless. The period header **wraps rather than truncates** at 375 — a date cut
off by an ellipsis is worse than a date on two lines, since the whole point of
the line is the exact period. `recap.ahead` and the partial family never appear
together — the first renders only under a period header, the second only when
there is none — and each sits on its own line rather than being appended to
whatever is above it, so neither the forward claim nor the blind-source warning
is the half that gets clipped. `recap.partialSince` and `recap.partialRepeated`
are two lines rather than one long sentence for the same reason: at 375 the
escalation must be the part that survives, and a clause appended to a wrapping
warning is the part a reader's eye drops.

**No new visual language.** The trigger uses the one sparkle identity the parent
document requires of every chat entry point; the recap reply is an ordinary Dovis
bubble; the period header uses existing muted-foreground and border tokens. Both
themes are real here — `chrome.tsx` ships a Light/Dark toggle with `aria-pressed`
on both and `next-themes` is a dependency, so this is not a dark-only product,
and the header, the partial line and the sample tag must all be checked in each.
Per the workspace rule the visual direction for this surface goes through
`stitch-to-shadcn` with the rest of the chat in build-order step 4; the recap adds
one button, a few lines of header and one inline tag, so it inherits that pass
rather than needing one of its own.

Verification, mirroring the parent document's step 5 rather than inventing a
different bar:

- `npx tsc --noEmit` and `npm run build`. The four new `Profile` fields must
  break `src/lib/demo-data.ts` first; a green build before the fixtures are
  updated means the type change was never made.
- `npm test`, with `tests/recap-envelope.test.ts` covering every verdict of
  `verifyRecapReply` — conforming and complete, conforming and partial, an
  explicit `error`, three malformed shapes (missing `kind`, wrong `kind`, absent
  `coverage`), a conforming reply with **no** `turn_id` on the adjacency branch,
  and an assistant's `delegated: []` against a reply claiming
  `coverage: {calendar: "ok"}`, whose `covered` must come back empty.
- Screenshots at **375 and 1440, in both languages**, of idle-never-run,
  idle-with-a-mark, working, no-reply, delivered-success, delivered-empty,
  delivered-partial and delivered-error.
- **Run two recaps back to back and confirm the second header shows the first
  run's window-open time.** This is the regression check for the stale-chip bug
  above, and it fails against today's provider.
- **Let a reply land with the tab shut (or the socket closed), then reload the
  thread.** Confirm the reconciliation confirms it on that load and that both
  columns move.
- **Force a first-ever recap to come back `partial` and confirm `recap.neverRun`
  renders nowhere on the page**, even though `last_scan_at` is still NULL. The
  never-run copy keys off the absence of a reply, not off that column.
- **Reload the thread three times after a non-advancing reply and confirm
  `/api/recap/seen` is called at most once for it in that session.** Without the
  evaluated-id memo the confirmation re-fires on every load for the whole
  duration of an outage.
- **Type an ordinary question into the recap thread while a run is in flight,
  then let the reply land.** On the echo branch, confirm `last_seen_at` takes the
  *run's* turn and not the typed one. On the adjacency branch, confirm the
  confirmation is refused outright — two unanswered user turns are ambiguous —
  and that the next recap re-covers the period.
- **Force `meta.result` to `error` and confirm both columns are unchanged in
  Postgres afterwards**, and that the surface renders `recap.runFailed` and never
  `recap.nothingNew`.
- **Force `empty` with full coverage and confirm `last_scan_at` moved**, and that
  the rendered message is `recap.nothingNew` with that timestamp in it. The pair
  of columns is only worth having if this is true.
- **Force `{"result":"success","coverage":{"mail":"unavailable","calendar":"ok"}}`
  and confirm neither column moved**, that `recap.partial` names mail and only
  mail — not the calendar, which was read — and that `recap.ahead` does **not**
  render, because the period header is withheld and the forward line only ever
  extends it. The two axes stay independent inside the verdict even though both
  lines are withheld together, which is what naming mail and only mail proves.
- **Send an assistant's `delegated: []` request a reply claiming
  `coverage: {calendar: "ok"}` and confirm `recap.ahead` still does not render.**
  The render gate is the intersection, so a reply can never add a source the
  request never delegated.
- **Delete `coverage` entirely from an otherwise perfect reply and confirm
  neither column moved.** Absence is failure; this is the check that proves it.
- **Send `result: "partial"` with a coverage map reporting every delegated source
  `"ok"` and confirm neither column moved.** The literal is a floor on the
  verdict, and this is the check that stops it being derived away.
- **The escalation, end to end.** Confirm a blind run writes `blind_since` and
  leaves both marks byte-identical in Postgres. Backdate that key 25 hours and
  confirm the chat line becomes `recap.partialSince` with the instant in it, that
  the Team page's Google card raises `googleBlindWarning` **with no chat open**,
  and that both marks are still unchanged. Take it to three blind runs in a row
  and confirm `recap.partialRepeated` joins the chat line; backdate the key to 72
  hours and confirm the card takes the destructive treatment with
  `googleBlindStale` — and that the marks are *still* unchanged through both.
  Then let one run come back fully
  covered and confirm `blind_since` is emptied, both warnings vanish, and the
  floor advances from where it had been sitting the whole time.
- **Let mail recover on a run the calendar is still failing.** With
  `blind_since` holding a mail key from Monday, send
  `{"result":"partial","coverage":{"mail":"ok","calendar":"unavailable"}}` and
  confirm `blind_since` afterwards holds the calendar key and *only* the calendar
  key, that both marks are byte-identical, and that neither `recap.partialSince`
  nor `googleBlindWarning` still names mail. The partial branch subtracts
  `covered`; without that subtraction the stale mail key survives until a fully
  covered run, which is the run the dark calendar is preventing.
- **Backdate two `blind_since` keys to different days and confirm the rendered
  instant is the LATER one.** Mail to Monday, the calendar to Wednesday, both
  still dark: `recap.partialSince` and `googleBlindWarning` must name both
  sources and interpolate **Wednesday**. The earliest key would over-claim the
  calendar's outage by two days in a sentence that names it.
- **Re-confirm one blind reply three times across two sessions and confirm the
  rendered escalation is identical each time.** The count is derived and
  `blind_since` is written only if absent, so a re-confirmation must move nothing
  — this is the check that would catch a stored counter creeping in.
- **Read the request turn's `meta` after a run and confirm it carries `lang`**,
  and that the reply's `result`, `kind` and `coverage` are ASCII literals in both
  languages. A localised envelope is `malformed`, by design.
- **Delete `kind` and confirm the verdict is `malformed`**, the prose still
  renders, no period header attaches, and the server log says why.
- Type each phrase in `recap.triggers` for both languages and confirm each one
  produces the same request as the button, and that a near-miss
  (*"catch me up on the Chen thread"*) does **not**.
- An assistant account confirming its recap contains no mail, no calendar and no
  draft bodies; that `recap.ahead` does not render above it; that its own marks
  *do* advance, since it delegates nothing; and that an owner's recap does not
  mention an assistant's unanswered turn.
- **The timezone field:** set it as the owner and confirm the header and the body
  both move; POST `/api/account/timezone` as an assistant and confirm 403; POST
  `"Mars/Olympus"` and confirm the column is unchanged and `timezoneInvalid` is
  announced; and confirm a completed owner recap naming a zone seeds an empty
  column but does **not** overwrite one the owner set.
- Demo mode at both widths: the trigger is present, the sample is labelled in the
  bubble and in the header slot, and no timestamp anywhere claims a real period.
- `curl -sL https://<the client deployment>/api/health` — follow redirects, a
  custom domain is normal, and `demo:false` marks a live client instance rather
  than the template. **Read the
  `google` flag for what it is:** three environment variables in the dashboard's
  own process, describing the dashboard's own OAuth client. It is `false` today
  and that is not a statement about the box, which holds a connected and verified
  Google Workspace MCP. `/api/google/status` is likewise a `stat` against the
  *local* filesystem, so from Vercel it describes Vercel. The only thing that
  reports whether Hermes could read mail on a given run is that run's own
  `coverage`. And once the chat PR lands, `hermes:true` says this deployment holds
  a URL and secrets — not that the box is up.

### Demo mode — decided 2026-09-05

Demo mode has no Supabase client, no session, no `messages` and no Hermes.
**The deployment owner's decision: keep the trigger visible, and label what it produces clearly
as a sample.** That reverses this document's earlier position, which ruled a
fixture recap out entirely — and the earlier text argued it badly, treating
"labelled sample" and "fabrication presented as real" as the same thing. They are
not. The rule that survives, unchanged and absolute, is the second one: **nothing
invented may ever be presented as real.** A sample that says so, in the place
where a real recap would state its period, is not a violation of that rule; it is
that rule enforced in copy.

The showcase deployment is the entire reason demo mode exists — a fresh clone
with no `.env.local` renders a complete working dashboard on fixtures — and a
chat whose headline feature does nothing when clicked shows the product as worse
than it is. `demoTodos`, `demoPayloads` and `demoWidgets` in
`src/lib/demo-data.ts` already do exactly this for the queue, and they are honest
because `chrome.tsx` carries `demoBanner` above every page.

**How a viewer tells a sample from a real recap at a glance**, three signals, in
descending order of how hard they are to lose:

1. **The header slot denies a period instead of stating one.** Where a real recap
   renders `recap.sinceDate` with a date, the sample renders `recap.sampleHeader`
   — "Sample recap — invented, and covering no real period". That line's only job
   is to say what the recap covers, so a sample that leaves it blank or borrows a
   real-looking date is the failure mode. It is also the line a screenshot crops
   last, because it sits directly above the prose.
2. **`recap.sampleTag` renders inside the reply bubble**, in the same DOM node as
   the prose — not a tooltip, not a toast, not a border colour. It survives
   scrolling, screenshotting and copy-and-paste into a chat window, which is how
   a fabricated recap would actually escape into the world.
3. **`demoBanner` is already above every page**, and stays.

The sample carries no envelope and goes through no validation, because there is
no reply row and no route: the demo renders the sample header and the sample
prose directly. It must therefore never render `recap.partial`,
`recap.partialSince`, `recap.partialRepeated`, `recap.nothingNew` or
`recap.ahead` — every one of them is a statement about a run that happened over a
real period, and the sample's header exists to deny exactly that. The two
escalation strings are the easiest of the five to leak in, because a designer
wanting to show the warning state in the showcase has an obvious reason to want
them; a sample warning that a real mailbox has been unreadable since Tuesday is
the fabrication this section forbids, wearing a timestamp.

The fixture itself should read as obviously fictional, the way `demoTodos`
already does: Stanley Chen and the Q3 budget, not a plausible stranger. A
`demoRecap` export beside the others — one paragraph, referring to items that
exist in `demoTodos`, so the sample is internally consistent with the queue on
screen rather than describing a parallel company.

**The sample moves no mark, and there is nothing for it to move**: demo mode has
no Supabase client, so `last_seen_at` and `last_scan_at` do not exist for a demo
viewer at all. Say it anyway, because the next half-state along is a deployment
with a real database and no Hermes, and there the answer is different.

**The sample is bound to `isDemoMode`, and to nothing else.** `isDemoMode` is
`!SUPABASE_URL || !SUPABASE_ANON_KEY` — a statement about Supabase only. A real
deployment with a real database and no Hermes configured is *not* demo mode, gets
`recap.unavailable`, and must never be shown a sample: invented content in front
of a boss with a real queue is exactly what the rule forbids. In production the
recap runs against the real backend, or it says it cannot.

### Failure modes

| Failure | Observable symptom | Mitigation |
|---|---|---|
| Run accepted, reply never lands (Hermes crashed, or the Realtime event was lost while the socket was down) | A pending bubble that never resolves | 90-second wait, then refetch the thread once — the same pattern as `refresh()`. If still nothing, `recap.noReplyYet` with `recap.checkAgain`. Never render an empty recap. Neither mark moves. |
| Reply lands but the browser never sees it | The next recap repeats a period the boss has already read, and the idle line goes on quoting an older review | The browser reconciles on the next load of the recap thread: a reply with an envelope newer than `last_scan_at`, not already evaluated this session, is confirmed then, so the marks converge instead of being lost with the tab. Until that load, repetition — the safe direction. Do **not** fix it by advancing on the acknowledgement. |
| A non-advancing reply re-confirmed on every page load | A pointless `/api/recap/seen` round-trip per load, for as long as a credential stays broken | `/api/recap/seen` returns the id it evaluated, and the browser remembers the ids it already has a verdict for. A non-advancing reply is confirmed at most once per session; `greatest()` keeps repeats harmless across sessions. |
| A confirmation pairs a reply with the wrong turn — the boss typed into the recap thread while a run was in flight | A floor that jumped over the run's own window: the silent hole, arriving through mispairing | The pair is never taken from the client. The reply names its originating turn on `meta` and the route rejects anything else. Without the echo, the route refuses any confirmation where more than one `role = 'user'` row is newer than the previous `dovis` row — the ambiguity itself is the rejection, not a row position. |
| POST rejected — 401, HMAC timestamp outside ±300s, box down — or the route's own queue assembly failed | Immediate error on the trigger | `recap.failed` with `recap.retry`. Nothing was forwarded, nothing was read, nothing was marked. |
| The run fails on the box | Without a durable failure row, indistinguishable from a run still in flight | Hermes writes a row carrying `result: "error"` — a requirement, not an assumption. The route refuses to advance either mark and the UI shows `recap.runFailed`. |
| The reply's envelope is missing, malformed, or of an unrecognised `kind` | A reply that looks like a recap and cannot be verified as one | `verifyRecapReply` returns `malformed`, which is treated exactly as an error: neither mark advances, no period header attaches, the prose still renders, and the server logs a contract mismatch. Fails closed by construction, including against a future box that changes the shape. |
| A deployment on the adjacency branch while the validator demands the echo | Every recap renders as a failure and nothing ever advances | The branch is one module constant, set with the box's configuration. `turn_id` is optional on the envelope; the route requires it only on the echo branch, and the two must be configured together. |
| A partially blind run — expired Google refresh token, Workspace MCP down | Prose that reads complete while a whole source went unread | The delegated set is recorded on the request turn by this server. Every delegated source must report `ok`; **an unmentioned source counts as blind.** Neither mark advances, `recap.partial` names the source, and the next recap re-covers the period. Closed 2026-09-05. |
| A source is blind for days | The floor does not move, so each recap repeats a widening queue delta | Accepted, and it is the deliberate cost of one floor. What repeats is the cheap half — rows this server assembles itself — and the chat says why every single time, until somebody fixes the credential. Never fix it by capping how far back a run looks: that rebuilds the hole by hand. |
| The daily `recap.partial` line becomes wallpaper | A credential dead since Tuesday, warned about in a sentence the boss now scrolls past | Escalation, decided 2026-09-05. At 24 hours dark the chat line becomes `recap.partialSince`, naming the instant from `blind_since`, and the Team page's Google card raises a persistent `googleBlindWarning` beside the Reconnect button. At three blind runs in a row `recap.partialRepeated` joins the chat line; at 72 hours the card takes the destructive treatment with `googleBlindStale`. Two thresholds because the two surfaces can measure different things — runs in the chat, days on the card. Volume only: no escalation moves a mark. |
| The boss stops opening the chat, so the only warning is somewhere he never looks | A silently degraded deployment | The 24-hour escalation deliberately leaves the chat for the Team page, which reads `profiles.blind_since` and renders with no recap on screen and no conversation loaded. |
| A blind-run count inflated by re-confirmation | A warning escalating on evidence that never existed — the reconciliation path re-posts a reply a later session already saw | The count is derived at read time by walking the conversation's recent replies, never stored and never incremented. `blind_since` keys are written only if absent and cleared on recovery, so both the count and the instant are idempotent under repeated confirmation, exactly as `greatest()` makes the marks. |
| A tidy-up that advances the floor to silence a loud warning | The escalation's own failure mode: the warning stops because the period was skipped, not because it was read | The partial branch writes `blind_since` and touches no mark, in a statement that does not contain `last_seen_at` or `last_scan_at`. Stated at every escalation point rather than once, because this is the change a later reader is most likely to make while "cleaning up" the recap. |
| A forward calendar claim above a run that read no calendar | "Plus anything scheduled in the next 7 days" on an assistant's recap, or above a mail-blind one with no period header | `recap.ahead` is gated on the verdict's `covered` — `delegated` intersected with the `"ok"` keys — and only ever renders beneath a period header. A reply can subtract from the delegated set; it can never add to it. |
| An error or a partial rendered as an empty recap | The boss reads "nothing new" about a mailbox nobody could open | Structurally impossible: `recap.nothingNew` is gated on a verdict of `advance` and interpolates `last_scan_at`, a column no errored, malformed or partially blind run can move. |
| "No recap has been generated yet." above a recap that is on screen | The dashboard contradicting itself on the boss's first-ever run | The never-run copy is chosen from the absence of any `dovis` reply in the recap conversation, not from `last_scan_at === null` — which since the full-coverage gate also describes a first run that came back blind. |
| A mark advanced past a recap nobody saw | A window silently absent from every future recap | The failure that actually matters. Advance only on a verdict of `advance`, only from the window-open stamp of the turn the reply itself names, only with `greatest()`, and only in the one route that writes them. |
| Triggered twice — button plus typed phrase, or two tabs | Two recaps in the thread, and two confirmations | `disabled` while in flight, per the shipped idiom, and `greatest()` on both columns keeps the marks sane in either arrival order. Cosmetic. Not worth a lock table. |
| Recap reports a `failed` item once and never again | The boss stops seeing an unaddressed failure | Report `failed`, `proposed`, `modifying`, stalled `executing` and open `priority = 'high'` items by current state, unconditionally, not by window. There is no mute control, by decision. |
| A sample recap mistaken for a real one | Invented content believed | Three independent signals, per the demo section: the header slot denies a period, `recap.sampleTag` sits inside the bubble, `demoBanner` sits above the page. Bound to `isDemoMode`, never to a missing Hermes. |

The double-trigger row previously leaned on "Hermes' native idempotency". **That
claim is dropped.** Hermes' answers say idempotency is *supported*, not
configured, and relying on it implies an idempotency key that `/api/recap` would
have to generate and send — which this design does not specify. `disabled` plus
`greatest()` is enough for a cosmetic duplicate; if a key is wanted later it is
its own small piece of work.

### Open questions — what is actually left

All twelve of the original list are closed, and so are the four this document's
own answers created. The deployment owner answered ten on 2026-09-05, `/api/payload/[id]`
answered its own when the route gained its `can_modify` check, and the twelfth —
**the recap toolset** — closed in a second round the same day. The second round
also closed **the result envelope** (this server defines and validates it, and
full coverage gates the floor) and **the timezone** (owner-controlled, seeded from
the owner's calendar, set explicitly on the Team page otherwise). The third round
closed the last two: **the escalation** (24 hours to a persistent warning on the
Team page's Google card, three blind runs in a row to a louder chat line, 72
hours to a destructive card, and no escalation touches a mark) and **the language
hint** (`/api/recap` sends it,
derived server-side, with the envelope staying language-independent).

Two things remain, and they are different in kind. One is a decision the third
round created rather than closed. The other is not a decision at all — it is a
fact about the box that nobody here can settle by thinking harder.

1. **`profiles.lang` — the deployment owner's, and the reason it is open is that
   answering them properly costs more than they asked for.** They said the server must derive the
   language from the authenticated dashboard preference. There is no such
   preference: language is `localStorage["dovis.lang"]`, read and written in
   `theme-provider.tsx`, and `profiles` has no `lang` column. So the fork is a
   column plus a route plus a toggle that starts talking to the server, against a
   validated `'en' | 'zh-TW'` on the request — a claim rather than a record, but
   not arbitrary once the enum is enforced, and no worse in its worst case than
   prose in the wrong language on the caller's own screen. **The recommendation is
   the column**, because it is what they actually said and because it incidentally
   fixes a real thing: today a boss's language does not follow him to his phone.
   The argument in full, including the divergence from the timezone route, sits
   with the strings above. **It blocks nothing.** The request turn carries `lang`
   either way, so the wire shape does not change and the column can arrive after
   the feature ships.
2. **Can Hermes echo the turn id back on the reply?** A yes/no from the box, and
   the only outstanding item that changes code rather than copy. With the echo,
   the confirmation route pairs a reply to its request turn by id and the boss may
   type freely during a run. Without it, the route falls back to the
   unanswered-turn rule and refuses every confirmation where the boss typed while
   a run was in flight — correct, and quietly more expensive than it sounds. It is
   already on the asks list below; it is repeated here because it is the one
   answer that decides which of two branches gets built, and the validator is
   pinned to that branch by a module constant rather than by inference.

**What is deliberately not on this list.** The escalation thresholds — 24 hours,
three consecutive blind runs in the chat, 72 hours on the Google card, twenty
rows of walk — and the split that has the chat count runs while the card measures
days are all decided above rather than deferred. If one of them turns out wrong it is a number to change, not a
question to reopen. **None of them may be changed by moving the floor**, which is
the one sentence that has to survive every future edit to this section.

### Where it sits in the build order

After step 3 of the list above, not before it. Steps 2 and 3 build the tables and
the transport this feature is a turn inside. The asks that remain for the box
should be sent together, because they are all questions for the same box and every
one of them changes what gets built:

- **The `owner-recap` route**, with a composed read-only toolset carrying
  `gmail_query_emails` and `calendar_get_events` from the Google Workspace MCP
  and nothing that writes, nothing on the filesystem or terminal, and no outbound
  web fetch — and explicitly **not** `no_mcp`, which would remove the very tools
  the route exists for. Plus its secret, as `HERMES_RECAP_SECRET`.
- **The envelope, on every reply, including failures.** `kind`, `result` and
  `coverage`, exactly as `src/lib/recap.ts` defines them, with `coverage` naming
  every source the request delegated — plus `turn_id` if the box can echo one. A
  run that dies must still write a row carrying `result: "error"`, or a failure is
  indistinguishable from a run still in flight. And a successful webhook response
  is **not** evidence the Supabase write happened — the acknowledgement says the
  run was accepted and nothing more, so the persistence needs its own retry and
  its own log on the box.
- **Accepting `lang` as a prompt hint** — `'en' | 'zh-TW'`, on the request beside
  `timezone` — and letting it select the prose language of the reply. **The
  envelope must not follow it.** `kind`, `result` and `coverage` stay ASCII
  literals in every language; a localised `result` is `malformed` on this side and
  advances nothing. Which value the dashboard sends is settled here, not there;
  what is asked of the box is only that it honour a hint.
- **Accepting the profile id and the turn id** on the request, and echoing the
  turn id back on the reply. **Whether the echo is possible is a yes/no that
  changes this side**: with it, the confirmation route pairs by id; without it, it
  falls back to the unanswered-turn rule and every confirmation is refused
  whenever the boss typed during a run.
- **The corrected schema.** `WEB-CHAT-DESIGN.md` renamed the column to
  `author_id` and explains why; Hermes' integration answers §9 still specify
  `owner_id` on both tables. If the deployment owner asks the box to insert replies without that
  correction travelling alongside, Hermes will build against a column name that
  does not exist.

What is **not** on that list is the stamping contract: the dashboard writes the
marks, and it decides what a valid result is. Hermes is asked to answer, to
report honestly what it could see, and to name the turn it answered.

The migrations are small and belong with the chat migration rather than a later
one, so each table is altered exactly once:

- `profiles.last_seen_at`, `profiles.last_scan_at`, `profiles.timezone`,
  `profiles.blind_since`
- `todos.decided_at`, and the `todos.created_at` not-null fix
- `messages.meta`, which belongs to the chat migration because that is where
  `messages` is created, and which now carries the request record as well as the
  result
- the one-line tightening of the `"owner updates"` policy on `profiles` to carry
  `and id <> auth.uid()`, mirroring `"owner deletes"` — which the timezone route
  depends on, since routing the owner's own settings through a server route buys
  nothing while the browser can write the row directly

`profiles.lang` is **not** on that list, because it is the deployment owner's
decision and it is still open. If they take the column, it joins the `profiles`
bullet and the table is still altered once; if they leave it, the validated enum
on the request needs no migration at all. That is the only reason the two are worth deciding before the
migration is written rather than after.
