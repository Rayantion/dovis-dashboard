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

Aaron: *"Yes assistant can use the chat, but externally, so yeah they can't
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
query box** (Aaron: *"not only read only, they able to use it to ask some
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

Aaron asked for "one thread", and for it to work "like Gemini web or app". Those
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

Visibility is **asymmetric**, per Aaron 2026-09-03: an assistant sees only their
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

Behaviour agreed with Aaron:

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

Clarified by Aaron 2026-09-03: the debounce is for **chat search** — finding
things he said in earlier conversations. So search runs over **message content**,
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

- **STT / TTS runs through Hermes**, configured on the box (Aaron, 2026-09-03).
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
- **Default language is set by Hermes** (Aaron, 2026-09-03), not chosen in the
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
| `Rayantion26/aaron-dovis-dashboard` (private) | `aaron-dovis-dashboard.vercel.app` | `demo:false, supabase:true, serviceRole:true` |

**This repo is upstream.** Work lands here, and Hermes pulls it into the private
client repo and adapts it there (Aaron, 2026-09-03). So committing to the
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
curl -s https://aaron-dovis-dashboard.vercel.app/api/health
# demo:false is the live client instance. demo:true means you are looking at
# the template and have proved nothing about production.
```

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

**Status: designed, not built. Blocked on the chat above.** Aaron asked for this
2026-09-03, alongside the chat itself.

A quick action inside the chat, also fired by typing *"Catch me up"* or *"What
did I miss?"* — and by their Chinese equivalents, which is a requirement and not
a nicety; see the strings below. It summarises what changed since the boss last
actually looked: relevant mail, calendar changes and upcoming meetings, new and
changed queue items, decisions, unresolved conversations, anything urgent. It
states the period it covers — *"Since your last review — 3 September 2026,
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

That ordering is not a formality. Two of the three hard problems below — where
the success signal comes from, and which route the run executes on — are decided
by how `/api/chat` and the Hermes routes are built. Deciding them here and
building them later is the right order; building this first is not possible.

### The endpoint, and what a recap turn actually is

**The primary endpoint is `POST /api/recap`**, not `/api/chat` with a flag in the
body. Two reasons, and the second is the load-bearing one. A flag in the body is
a client-supplied route selector, which this design refuses everywhere else —
`{"role":"assistant"}` is not evidence of anything, and neither is
`{"recap":true}`. And `/api/recap` is the **only** door that opens a review
window and hands out the stamp that will later close it. The mark itself is
written by exactly one of two actors — Hermes, or `/api/recap/seen` — and never
by `/api/chat`, never by the browser. Keeping the window-opening behind one
narrow door is worth more than the handful of lines the two routes share.

What it does, in order: authenticate the session with `requireProfile()`; read
the caller's `last_seen_at`; find or create that caller's recap conversation;
insert the user's turn; take the window-open stamp from that inserted row; then
forward to Hermes. The insert happens before the forward, matching what
`/api/chat` already has to do.

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
prompt is a downgrade rather than an escalation. It is about the mark: any POST
to `/api/recap` moves `last_seen_at`, and a turn that is not a recap request must
not be allowed to burn the boss's window.

Normalise before comparing: trim, collapse internal whitespace, lower-case, and
strip trailing punctuation in both scripts (`.`, `?`, `!`, `。`, `？`, `！`). So
"What did I miss?" and "what did i miss" are one entry. **Compare for equality,
not containment.** A substring match fires on *"before you catch me up, tell me
what the Chen contract says"* and answers a different question on the recap route
with a period header attached to it, which is a lie about what the turn was.

A phrase the matcher misses falls through to `/api/chat` and is answered on the
ordinary route with wider tools. That is a miss toward a capability the principal
already has, so it is not an escalation — but the read-only guarantee and the
period header silently do not apply to that turn, and the mark does not move.
**The guarantee covers the button and the listed phrases. It does not cover every
sentence that means the same thing, and it must not be described as if it does.**

### The review mark

One durable fact per authenticated user, on the row the owner already audits:

```sql
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'The moment the last successfully generated recap OPENED its window: the '
  'created_at of the user turn that requested it, never the reply''s. NULL means '
  'no recap has ever run for this account. Advanced only when a recap exists — '
  'never on page load, never on refresh(), never on a webhook acknowledgement.';
```

`add column if not exists` because `schema.sql` is re-runnable by design — it
uses `create table if not exists`, `create or replace function` and
`drop policy if exists` throughout, and a bare `add column` fails on the second
run and aborts everything after it.

Nullable, no default. A default of `now()` would make the very first "Catch me
up" cover zero elapsed time, which is the one run where the window matters most.
NULL means *no prior review*, the route substitutes a default first window, and
the header states the window that was actually used rather than a fixed sentence
about the last 24 hours.

The earlier draft of this comment said the column "sits beside `last_sign_in_at`
and means something else: signing in is not reviewing." **That comparison is
wrong in this deployment and has been removed.** `last_sign_in_at` has exactly
one writer — `src/app/api/auth/password-changed/route.ts` — and `signIn()` in
`dovis-provider.tsx` never touches it, so the column records the last *password
change*. Anchoring a permanent schema comment to that would bake the
misunderstanding in. Renaming the column is a migration plus a route change plus
a `types.ts` change for a column this feature never reads, so it is **recorded
here as a live finding and deliberately not folded into this work.**

**No client code writes the mark, and there is no self-UPDATE policy — but the
owner's browser can still write it today, and an earlier draft asserted otherwise.**
`"owner updates"` in `schema.sql` §4 is
`using (public.dovis_is_owner()) with check (public.dovis_is_owner())`, with no
restriction on which row it applies to — unlike `"owner deletes"`, which carries
`and id <> auth.uid()`. `dovis_is_owner()` is true for the owner on every row
including their own, so the owner's browser, holding the anon key and its own
JWT, can `update profiles set last_seen_at = '2030-01-01' where id = auth.uid()`
straight through PostgREST and permanently blank its own window. That is the
failure this section calls the one that matters, reachable from the client as the
schema stands. It also undercuts the care taken below to have the fallback route
accept an id and never a timestamp, since the column can simply be written
directly.

Nothing in the repo uses that capability: every `profiles` write is server-side
under `service_role`, `/api/team/update` included, and `service_role` bypasses
RLS entirely. **So mirror `"owner deletes"` and add `and id <> auth.uid()` to
`"owner updates"`.** It costs nothing, because no client path relies on the owner
updating their own row, and it closes the only client-reachable way to corrupt
the mark. That one line belongs with the migrations at the foot of this section.

**Do not, separately, add a client policy to make the browser a legitimate
writer.** Postgres RLS cannot restrict which *columns* an UPDATE touches, so a
self-update policy on `profiles` is a self-update policy on `role`, and that is
the worst line available in this codebase. The established shape is already in
the repo: `/api/auth/password-changed` writes under `service_role` after
`requireProfile()` succeeds, with no client policy at all. The mark follows it.

**The mark advances to the moment the window was OPENED, not to the recap
reply.** An earlier draft had it advance to the reply row's `created_at` and
claimed open-ended windows have no seam under any clock. **That was a logic error
and it produced exactly the failure this section calls the one that matters.**
Trace it. Hermes reads the sources at T1 and inserts the reply at T2, and a
mail-and-calendar summarisation on a 4GB box is tens of seconds, not
milliseconds. If the mark becomes T2, every row written in (T1, T2] was too late
for this run to read and is already below the next run's floor. **No recap ever
reports it.** A whole model-run's worth of mail, silently, every single time.

Advancing to T0 — the instant the window opened, before Hermes was called —
collapses the seam in the safe direction. Rows written in (T0, T1] are read by
this run *and* sit above the new mark, so the next run repeats them. Repetition
is the benign failure; a hole is not.

**Take T0 from Postgres, not from Node.** `todos.created_at` is a Postgres clock
value, and the recap's whole windowed half is a comparison against it. A
`new Date().toISOString()` taken on Vercel introduces a skew between two clocks
into the one predicate that must not have one. The user turn `/api/recap` inserts
before forwarding already carries a Postgres `default now()`, so read it back
with `.select()` and use that: it is the request time, it is on the right clock,
and it is provably before Hermes read anything.

That also makes the Hermes-side contract easier to state. The instruction is
**"stamp this exact timestamp we are giving you"**, not "stamp `now()`".

**Advance it monotonically** — `greatest(last_seen_at, $1)` — because the two
directions are not symmetric. A mark that lands too far back shows the boss an
item twice. A mark that lands too far forward loses it silently. `greatest`
ignores NULLs in Postgres, so the first run needs no `coalesce`.

**Both writers enforce that, Hermes included, so the contract above is a
statement rather than an assignment:**

```sql
update public.profiles
   set last_seen_at = greatest(last_seen_at, <the exact value supplied>)
 where id = <the caller's profile id>;
```

Phrased as a plain assignment it carries no guard, and two overlapping runs — the
double-trigger row below concedes they happen — land their marks in completion
order rather than value order. The direction is safe, so nothing vanishes; but an
invariant enforced on neither of the two writers this design actually recommends
is not an invariant, and the failure table cites it as though it were.

#### A run that could not read a source burns that source's window

The mark is one timestamp covering every source, and that is where the remaining
hole is. A recap whose Google refresh token has expired still produces a reply,
so under the rule above — *advanced only when a recap exists* — the mark advances
to T0 regardless. Every mail item in (previous mark, T0] then sits below every
future floor. **No recap ever reports it**, which is the same silent hole as the
T2 error, arriving on the mail axis instead of the timing axis, and it is the
likeliest of the three to actually happen: an expired refresh token is routine.

**Recommendation: advance the mark only on a run that reports full source
coverage.** A partially-blind run leaves the mark where it was, and the next
recap re-covers the period, which is the benign direction again. That requires
the run to say which sources it actually read — a structured signal, not prose —
which is why open question 5 is not a presentation question. It decides whether
this is buildable at all.

**If the answer is prose, then per-source burn is accepted, and it must be said
plainly rather than left as "covers less than it appears to" in a mitigation
column.** In that case a recap that could not reach the mailbox costs the boss
that window of mail permanently, and nothing on this side can detect it or
compensate for it.

#### Who advances it, and why this is the unresolved part

The webhook response is an acknowledgement that the run was accepted, not the
answer. So `/api/recap` never learns that a recap was generated; it learns only
that a run started. Advancing on the ack burns the period on a run that may die
on the box, and the boss loses that window permanently with no way to know.

The only actor that knows a recap exists is Hermes, at the instant it inserts the
reply into `messages` with the service-role credential it already holds.

**Recommendation: Hermes stamps the mark in the same service-role write.** One
write, by the one process that knows the recap is real, in the same transaction
as the row that proves it. It needs no new dashboard route, no client policy and
no ack heuristic. The value it writes is the one `/api/recap` handed it, through
the `greatest()` statement above.

**This is a Hermes-side contract that does not exist today**, and it is the same
class of assumption that has already been retracted twice in this document —
per-request toolsets, and Telegram persistence. Confirm it against the box before
designing around it.

It also needs the recap run to be told which profile it is answering for.
**Neither `WEB-CHAT-DESIGN.md` nor Hermes' integration answers describe the
caller's profile id crossing the wire** — step 2 says the route forwards "the
last N turns", and Hermes' §2 step 4 says the same. So this is a field
`/api/recap` has to add and Hermes has to accept, not a capability that already
exists. Saying otherwise in a paragraph about unverified Hermes assumptions would
be the mistake this paragraph is about.

**If the box will not do that**, the fallback is entirely on this side, and it
must be built carefully:

```
POST /api/recap/seen   { "turnId": "<uuid of the user turn /api/recap inserted>" }
```

Server-side, after `requireProfile()`: load that message by id under
`service_role`; reject unless `role = 'user'` **and** `author_id` is the caller's
own id; reject unless a `dovis` row exists in the same conversation with a later
`created_at` — that existence check *is* the arrival proof; then write
`last_seen_at = greatest(last_seen_at, <the created_at of the user turn
identified by turnId>)`.

**The dovis row is used only as proof that a reply arrived. Its own `created_at`
is never written.** Writing the reply's timestamp here would reintroduce, on the
branch that ships if Hermes says no, the exact (T1, T2] hole the primary path
spends three paragraphs eliminating. The value written is always the window-open
stamp, on both paths.

**The browser supplies an id and never a timestamp.** An earlier draft had the
client pass the recap row's `created_at` directly, which hands a buggy or hostile
client the ability to send any future timestamp and permanently blank a window —
the failure above, on demand. `requireProfile()` establishes *who is calling*,
not *what they may claim about a row*, and this repo makes that distinction
carefully everywhere else. The route derives every timestamp itself.

The fallback attests *arrival* rather than *generation*, which is weaker — a
recap that lands while the socket is down does not advance the mark until the
thread is refetched — but it fails in the safe direction, and it is buildable
without the box. Take it only if the first answer is no.

#### How the browser learns the new mark

**It does not learn it on its own, and the earlier draft missed this.** The
column arrives free at bootstrap on both existing read paths — the provider does
`.from("profiles").select("*").eq("id", user.id).single()` and `requireProfile()`
does the same server-side — but nothing refreshes it afterwards. `profiles` is
**not** in the realtime publication (`schema.sql` §5 adds only `todos` and
`dashboard_widgets`), so a service-role write never streams. And `fetchAll()`
never touches `session.profile`: for an owner it refetches the profiles *list*
into separate state, and for an assistant it deliberately returns
`profiles: null`. So without a fix, the second click of the day still renders the
first window's date, for the rest of the session.

The fix is the shape the provider already uses — but **the window and the mark
are two different values, and only the second one is the mark.** `/api/recap`
returns at T0, before Hermes has been called and before anything has been
stamped; on the recommended path the mark may never move at all, because the run
may die on the box, in which case the database correctly keeps the old value.
Writing that returned window into `session.profile.last_seen_at` would have the
browser believe a mark the database does not hold, and the next trigger would
then claim a narrower period than the run it launches actually covers — the one
thing the header must never do.

So keep them apart:

- **The window `/api/recap` returns is per-run state**, held for that run's
  header and nothing else. It is what the pending bubble and the delivered reply
  are labelled with, and it never touches the session.
- **`session.profile.last_seen_at` is patched only on evidence the mark moved.**
  On the Hermes path that evidence is the dovis reply landing in the recap
  conversation over Realtime — `messages` *is* in the publication, per the parent
  document — after which the client re-reads its own profile row, which the
  `"read own profile"` select policy already permits. On the fallback path,
  `/api/recap/seen` returns the mark it just wrote and that response is
  authoritative on its own.

Either way the patch itself is the idiom `changePassword` already uses:

```ts
setSession((s) => (s ? { profile: { ...s.profile, last_seen_at: next } } : s));
```

`Profile` in `src/lib/types.ts` gains `last_seen_at: string | null` in the same
change — that file's own comment requires it to mirror the schema exactly.

#### The `is_owner()` duplicate, now fixed upstream

An earlier draft of the chat schema above introduced `public.is_owner()` beside
the `public.dovis_is_owner()` that `supabase/schema.sql:157` already ships. This
review caught it and the Schema section has been corrected in place, so there is
nothing left to carry into the chat PR.

Recording it because the *class* of mistake will recur: a design document written
against a remembered schema invents helpers the real schema already has, and two
functions with one meaning drift apart across migrations. The check is cheap —
grep the schema for the helper before writing a policy that needs one.

### The Hermes route, and why the recap wants its own

Aaron's constraint is that read-only must be structural — role, auth and tool
restrictions, not a prompt. That rules out running the recap on `owner-chat`,
because `owner-chat` is bound to `hermes-telegram`, which Hermes describes as the
*"full normal core toolset, including filesystem/terminal/memory/etc."* A recap
answered there is read-only only because it was asked nicely, which is precisely
the guarantee this architecture rejects everywhere else.

So the recap wants a third route, with its own secret and a toolset carrying
mailbox and calendar **reads** and nothing that writes:

```yaml
routes:
  owner-recap:
    secret: "server-side-recap-secret"
    toolsets: [ ... read-only, if it can be defined at all — see below ... ]
```

**This is a change to Aaron's box, not a decision the dashboard gets to make**,
and it is grouped with the other Hermes asks rather than stated as settled. It
costs a config edit, a third secret to store and rotate, a `HERMES_RECAP_SECRET`
in `.env.example` and in Vercel — and, per the question below, it may not be
constructible at all.

**Whether that toolset can be built is unverified and load-bearing.** Hermes
exposes fixed toolsets per route and names three built-ins. `hermes-telegram` is
far too wide. `hermes-webhook` has no mail or calendar read at all, and adds
outbound web fetch, which is the one capability an injection-summarising run
should not have. Neither is right. The config shape suggests toolsets are named
and composable, and the answers say *"relevant built-in toolsets"* rather than
*all* — but that is inference, not confirmation. Ask the box before designing
around either answer. If a custom read-only toolset is not definable, **the recap
degrades to the queue and conversation delta with no mailbox and no calendar** —
smaller, still honest, still worth shipping, and it takes upcoming meetings with
it, which is the largest single thing that answer costs.

The one thing the fallback must **not** be is "run it on `hermes-telegram`
anyway". Beyond the obvious, that toolset carries filesystem and terminal, so the
recap prose itself could quote VPS paths back to the browser. Aaron's standing
rule is that private filesystem paths are never exposed. Worth noting the rule is
already bent once elsewhere: `/api/google/status` returns `credentialsDir` and
`tokenFilePattern` (e.g. `/home/jarvis/mcp-google-workspace`) to the client. That
is owner-only and it is a separate finding, but it means "we never leak paths" is
not currently true and should not be asserted.

**Be honest about what the route buys.** It is not a defence against an
adversary, because there is no escalation to defend against: the same owner
reaches the full toolset by typing anything else into the same chat window, and
Dovis reads the same mailbox on Telegram today. What it buys is that the *recap
run itself* structurally cannot act — which is exactly what Aaron asked for, and
which no prompt can deliver.

### What an assistant's recap can contain

Downstream of build-order step 1, which is still open: whether an assistant's
chat gets mailbox and calendar **read** tools at all. The recap does not merely
touch that question, it forces it — the box holds exactly one Google credential,
the owner's, and there is no per-caller Google identity. An assistant recap that
reads mail reads the principal's mail with the principal's token. Aaron should
make the call in those terms.

If reads stay withheld, which is still the recommendation, an assistant's recap
is the queue plus their own conversations, by construction rather than by
instruction.

**An assistant's recap runs on `assistant-chat`, not a fourth route.** That route
is `hermes-webhook` + `no_mcp` — web search, extraction, vision, clarify — which
already has no mail, no calendar and no writes of any kind, so a recap-specific
route beside it would buy nothing. The read-only guarantee there comes from the
existing toolset rather than from a recap-specific one. If Aaron ever grants
assistants mailbox reads, that changes: an `assistant-recap` route becomes
necessary for the same reason `owner-recap` is.

**Note the toolset does not supply even the queue.** `hermes-webhook` has no
database read of any kind. So an assistant's queue delta and their own unanswered
turns have to be assembled by `/api/recap` under the caller's own identity and
forwarded as context, the same way the last N turns already are. The toolset is
what makes the recap unable to reach *further*; it is not what makes it able to
reach the queue.

Scoping is free where it matters. `messages` and `conversations` select on
`author_id = auth.uid() or dovis_is_owner()`, so an assistant's own-thread half
is bounded by RLS. `todos` is readable by every active account — `read todos`
uses `dovis_is_active()` with no author dimension — so a queue delta discloses
nothing an assistant cannot already see on screen.

**The copy must not promise mail it will never show.** A recap that prints an
"Email" heading with nothing under it asserts a quiet mailbox rather than an
absent capability. If a scope line is needed it should describe what the recap
does cover, and it should be written after the read question is answered, not
before it.

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
the recap turn and nothing wider. It is worth having because Aaron asked for that
one turn to be structurally incapable of acting — not because it closes a door
that is otherwise open.

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

**Windowed, against the mark:** genuinely new proposals (`created_at`), approvals
(`confirmed_at`), completions (`completed_at`).

**Unconditional, by current state, regardless of the window:** open `proposed`
items, `modifying` items, `failed` items, rows sitting in `executing` long after
a run should have finished, open items carrying `priority = 'high'`, and — see
below — upcoming meetings. These are reported every time until they are dealt
with. Time-windowing a failure would make a real, unaddressed failure vanish from
the second recap, which is worse than repeating it.

**That repetition is a deliberate product behaviour, not a mitigation.** It means
the boss reads the same unresolved failure every morning until he acts on it.
That is the intent — an unaddressed failure that stops being mentioned has been
hidden, not resolved — but it is the kind of thing that reads as a bug on day
three, so it is stated here rather than buried in a table.

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

**Upcoming meetings are forward-looking and cannot be a delta.** Aaron asked for
"calendar changes *and* upcoming meetings", and every other mechanism in this
section is a comparison against `last_seen_at`. A recap run five minutes after
the last one has no calendar *changes* and must still say what is coming. So
upcoming meetings sit in the unconditional half with a fixed forward horizon,
asked for explicitly on every run. **The recommendation is the next 24 hours, and
it is a recommendation rather than a settled number**: 24 hours keeps a daily
recap tight, and it is wrong for a boss who wants Monday's recap to warn him
about Wednesday's board meeting. It is the same shape of product-visible span as
the first-run window, so it is folded into open question 1 rather than decided
here. Since the reply is prose (open question 5), the separation between *what
changed* and *what is coming* is Dovis's to make in its own words; the route can
only ask for it, and this design should not pretend otherwise.

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
should not be reported as news. The alternative is to accept that rejections are
unreportable, which is a worse product for one saved column.

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
wanted, that is an actor column and a separate decision.

### Unresolved conversations

The earlier draft listed these among the contents and never said what one is.

**Definition: a conversation whose most recent `messages` row has
`role = 'user'` and is older than ten minutes.** The boss asked something and
Dovis never answered — a crashed run, a lost webhook, a reply that failed to
insert. The ten minutes exclude a turn that is simply still in flight. It is a
narrow definition on purpose: any looser one ("a thread that trailed off") is
unfalsifiable, and every finished conversation ends with a `dovis` row, so
without the role test the predicate matches nothing or everything.

**Whose unresolved threads appear in the owner's recap is a product decision with
a privacy edge, and it is Aaron's.** RLS lets the owner read every assistant's
conversations, so a naive query pulls an assistant's half-finished question into
the boss's morning summary. The recommendation is **no** — scope the owner's
unresolved list to `author_id = <owner>` — because the parent document's own
reasoning applies directly: an assistant is told they are visible precisely
because surprise visibility is a trap, and *auditable on inspection* is a
materially different arrangement from *pushed into the principal's daily
briefing*. Recorded as an open question rather than settled.

### UI states, and the strings

The recap is a chat turn, so most of what the reader sees is a `messages` row
Hermes wrote. The dashboard owns the trigger, the period header, and the states
where no message exists yet.

| State | What is on screen |
|---|---|
| Idle | The quick action in the chat's action row. Not in the Danger zone, not in the header. |
| Working | The user's turn is in the thread; a pending Dovis bubble with `recap.working`. The trigger is `disabled` while in flight, matching `queue.tsx` and `refresh-control.tsx`. |
| No reply yet | After **90 seconds**, refetch the thread once. If still nothing: `recap.noReplyYet` plus `recap.checkAgain`. The mark has not moved. |
| Failed to send | The POST itself failed — auth, HMAC timestamp outside ±300s, box unreachable. `recap.failed` plus `recap.retry`. Nothing was read and nothing was marked. |
| Backend not configured | `/api/recap` answers 503 with `reason: "hermes-unconfigured"`, and only that reason renders `recap.unavailable`. |
| Delivered | An ordinary Dovis message, with `recap.sinceDate` (or `recap.sinceFirst`) above it. |
| Demo | Open question 8. The table deliberately does not settle it. |

**90 seconds, and why that number.** The HMAC timestamp window is ±300 seconds,
so a run that has produced nothing well inside that is either slow or dead and
the UI cannot tell which; and a mail-and-calendar summarisation on 4GB / 2 vCPU
is tens of seconds, not seconds. It is a **UI timeout only**: the mark never
advances on a timeout, and a reply that lands at 200 seconds still arrives over
Realtime and still advances the mark when it does.

**The "backend not configured" state needs something to detect, and today there
is nothing.** `isDemoMode` in `src/lib/config.ts` is `!SUPABASE_URL ||
!SUPABASE_ANON_KEY` — a statement about Supabase only. A real deployment with
Supabase configured and no Hermes environment is neither demo nor working, and
`.env.example` declares no Hermes variables at all. Two changes, and the first
belongs to the chat PR rather than this one: declare `HERMES_WEBHOOK_URL` and the
per-route secrets in `.env.example`, and add a `hermes` boolean to `/api/health`
alongside `demo`, `supabase`, `serviceRole` and `google` — that file's own
comment already argues this exact case ("Supabase configured but no service_role
is the nastiest half-state"). The UI, though, should not fetch `/api/health` to
decide what to render; it distinguishes *unavailable* from *failed* by the
response `/api/recap` gives it, which is the only source that actually knows.

**Whether there is a client-rendered empty state is Aaron's call, not this
document's.** He listed loading, empty, error and retry explicitly. The
recommendation here is **no empty state**: "Nothing changed since your last
review" is a claim only a run that actually looked can make, and the dashboard
cannot distinguish *looked and found nothing* from *never looked*, so an empty
recap should be Dovis saying so in its own reply. The dashboard's near-empty
states would then all be about transport — no reply yet, could not reach the box
— and never about content. But that reverses an explicit instruction, and it sits
uneasily beside open question 5: if the reply is prose, the empty-versus-failed
distinction lives entirely in Dovis's words and **cannot be enforced from this
side at all**. Recorded as a question.

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
  working:      "Dovis is catching you up",
  noReplyYet:   "No reply yet. The run may still be going.",
  checkAgain:   "Check again",
  failed:       "Couldn't reach Dovis. Nothing was read and nothing was marked.",
  retry:        "Try again",
  unavailable:  "Catch me up needs a real Dovis box. It does nothing on the demo.",
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
  working:      "Dovis 正在幫你整理",
  noReplyYet:   "還沒有回覆，執行可能還在進行中。",
  checkAgain:   "再看一次",
  failed:       "無法連線到 Dovis。沒有讀取任何內容，也沒有更新進度標記。",
  retry:        "重試",
  unavailable:  "補進度需要真正的 Dovis 主機，示範站台不會有。",
},
```

**The trigger phrases are dictionary keys, not English literals, and that is the
point.** An earlier draft matched two hard-coded English strings, which means a
繁中 boss typing 「補進度」 falls through to the ordinary route, gets the wide
toolset, gets no period header, and the read-only guarantee silently does not
apply to the entire Chinese half of the product by default. The matcher tests the
normalised turn against the union of every language's list, not just the viewer's
current one, because the toggle is per-viewer and a boss who switches to English
mid-session should not lose his Chinese phrases.

Three register corrections against the shipped dictionary. `quickAction` is
「補進度」, three characters, because every other action label is two to four
(`確認` / `修改` / `退回` / `重新整理` / `顯示`) and the earlier
「幫我補進度」 is a seven-character sentence that will not sit in a row beside
them — it survives as a *typed* trigger, where sentence length is natural.
「檢視」 replaces 「查看」 for review, matching `readOnlyHint`:
「你的帳號可以檢視佇列」. And 「執行可能還在進行中」 replaces 「工作可能還在進行」,
since 工作 for a model run reads as generic "work" rather than the ordinary
Taiwan technical register. `checkAgain` is 「再看一次」, which sidesteps both
檢視 and 重新整理 (already Refresh) rather than overloading either.

Nested under `recap` to match `t.status.*` and `t.action.*`. The
`export const languages: Record<Lang, Dict> = dict` assertion at the foot of
`i18n.ts` covers nested shape, so a key added to `en` and forgotten in `zh-TW`
fails the build rather than rendering `undefined` mid-sentence — which is exactly
the behaviour wanted for `triggerAriaFirst`, a key that must land in both
dictionaries or in neither. The assertion does **not** check that `triggers` is
non-empty — `string[]` satisfies the type when empty — so one unit test asserting
every language's `triggers[0]` exists is worth the three lines, since an empty
array silently disables typed triggering for that language and nothing else would
notice.

`{when}` interpolates with `.replace("{when}", …)`, the same idiom `{n}` already
uses in `waitingHeadline`. Both first-run and returning copy take the same slot
on purpose: whatever the default first window turns out to be, the header states
the window that was actually used and cannot claim a period the run did not
cover.

Format with **`toLocaleString`**, not `toLocaleDateString`. `page.tsx` uses
`toLocaleDateString(lang === "en" ? "en-GB" : "zh-TW", { weekday, day, month })`
— locale choice and field style to copy, but it passes no time fields at all, so
it demonstrates nothing about formatting a time through that call. Time options
do happen to survive `toLocaleDateString`, but only through an ECMA-402 corner,
and it reads as a mistake to the next maintainer. Use the right call, keep the
`en-GB` / `zh-TW` choice (which gives "3 September" rather than "September 3"),
add `hourCycle: "h23"` so zh-TW renders 09:20 rather than 上午09:20, and
**include the year unconditionally**. The mark can be months old on a box that
has been running a while — the exact scenario open question 1 turns on — and a
conditional year is a branch that is wrong for eleven months of testing and right
in the twelfth.

One honest gap: the chrome follows the viewer's toggle, but the recap **body**
comes from Hermes, whose default language is set on the box. A 繁中 viewer can
get Chinese headings around English prose. The fix is for `/api/recap` to forward
the viewer's `lang` as a prompt hint — it selects a prompt, not a toolset, so the
route binding is untouched. Worth confirming rather than assuming.

### Accessibility

Absent from the earlier draft entirely, and explicit in Aaron's ask. The repo
already sets every pattern needed, so this is matching, not inventing.

**The tail of the thread is a live region, it is only the tail, and it is mounted
before there is anything in it.** The recap's tail slot carries `role="status"` —
which implies `aria-live="polite"` without spelling it out, and is the idiom
`StaleBanner` already uses and a maintainer will recognise. Copy the attribute,
but not `StaleBanner`'s mount behaviour: it early-returns null
(`if (pendingCount === 0 && !degraded) return null;`), so its region enters the
DOM already holding its text, and a live region registered together with its
content commonly announces nothing at all. The recap slot renders empty on thread
load and is never conditionally returned, so the pending bubble and the reply
that replaces it are both *mutations inside an already-registered region*, which
is the thing that actually gets announced.

That matters twice over, because the reply is the whole point. If the Dovis reply
renders in the transcript proper for layout reasons rather than inside the slot,
then the pending bubble's *removal* is all that happens to the region — and
removal is not announced under the default `aria-relevant="additions text"`, so
the asynchronous arrival this subsection exists to handle reaches nobody. Either
keep the reply inside the persistent slot, or keep the slot and write a short
announcement into it when the row lands (`recap.sinceDate`, or the reply's first
line) rather than trusting the transcript insertion to be noticed.

The region is the tail slot alone rather than the whole transcript — but not for
the reason the earlier draft gave. Content present when a region is registered is
not announced, so a live transcript would not "read every historical message
aloud on mount". The real cost is that every *later* mutation of the transcript —
pagination, a refetch, an ordinary re-render — would be announced.

**The trigger's accessible name is a full sentence, its visible label is a
word.** `RefreshButton` already does this — `aria-label={label}` carries
"Reconnecting — this may be out of date" while the visible text stays "Refresh".
So the recap trigger renders `recap.quickAction` and carries
`recap.triggerAria` with the period interpolated: "Catch me up on everything
since your last review, 3 September 2026, 09:20". That is a real string in both
dictionaries above, not a repetition of the visible label.

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
go false in the *same* render commit that inserts the reply — both derived from
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
reads the page, not only by a hovering mouse.

### Responsive, theme, and how it is verified

Also absent from the earlier draft, also explicit in the ask.

The trigger sits in the chat's action row and follows the shipped split: the
visible label may hide below `sm` the way `RefreshButton`'s does
(`hidden sm:inline`), because the `aria-label` carries the full sentence
regardless. The period header **wraps rather than truncates** at 375 — a date
cut off by an ellipsis is worse than a date on two lines, since the whole point
of the line is the exact period.

**No new visual language.** The trigger uses the one sparkle identity the parent
document requires of every chat entry point; the recap reply is an ordinary Dovis
bubble; the period header uses existing muted-foreground and border tokens. Both
themes are real here — `chrome.tsx` ships a Light/Dark toggle with `aria-pressed`
on both and `next-themes` is a dependency, so this is not a dark-only product and
the header must be checked in both. Per the workspace rule the visual direction
for this surface goes through `stitch-to-shadcn` with the rest of the chat in
build-order step 4; the recap adds one button and one line of header, so it
inherits that pass rather than needing one of its own.

Verification, mirroring the parent document's step 5 rather than inventing a
different bar:

- `npx tsc --noEmit` and `npm run build`.
- Screenshots at **375 and 1440, in both languages**, of idle, working, no-reply
  and delivered.
- **Run two recaps back to back and confirm the second header shows the first
  run's window-open time.** This is the regression check for the stale-chip bug
  above, and it fails against today's provider.
- Type each phrase in `recap.triggers` for both languages and confirm each one
  produces the same request as the button, and that a near-miss
  (*"catch me up on the Chen thread"*) does **not**.
- An assistant account confirming its recap contains no mail and no calendar.
- `curl -s https://aaron-dovis-dashboard.vercel.app/api/health` — `demo:false`
  is the live client instance, and once the chat PR lands, `hermes:true` is the
  one that says this feature can run at all.

### Demo mode, and not fabricating

Demo mode has no Supabase client, no session, no `messages` and no Hermes. The
chat as a whole has no demo behaviour designed yet, and the recap's is a subset
of that answer — it should be decided when the chat is built, not here. The state
table above deliberately leaves the row open rather than pre-empting it.

What is settled now is the rule: **the recap must never synthesise.** No fixture
recap presented as real, and in particular no client-rendered "you're all caught
up", because that sentence is a claim about a mailbox nobody read. If a labelled
sample is wanted on the public showcase, it is a deliberate product decision and
it sits closest to this line of anything in the feature — Aaron's call, recorded
below.

The existing precedent argues for restraint rather than simulation:
`google-connect.tsx` replaces the whole card with one sentence
(`googleUnavailable`) rather than faking a connected state, and `chrome.tsx`
already carries `demoBanner` above every page.

### Failure modes

| Failure | Observable symptom | Mitigation |
|---|---|---|
| Run accepted, reply never lands (Hermes crashed, or the Realtime event was lost while the socket was down) | A pending bubble that never resolves | 90-second wait, then refetch the thread once — the same pattern as `refresh()`. If still nothing, `recap.noReplyYet` with `recap.checkAgain`. Never render an empty recap. The mark does not move. |
| POST rejected — 401, HMAC timestamp outside ±300s, box down | Immediate error on the trigger | `recap.failed` with `recap.retry`. Nothing was read, nothing was marked. |
| Reply landed, mark did not advance | The next recap repeats the same period | Benign, and the safe direction. Do **not** fix it by advancing on the acknowledgement. |
| Mark advanced past a recap nobody saw | A window silently absent from every future recap | The failure that actually matters. Advance only where success is known, only to the window-open stamp, and only with `greatest()` — on both writers, Hermes included. |
| Triggered twice — button plus typed phrase, or two tabs | Two recaps in the thread | `disabled` while in flight, per the shipped idiom, and `greatest()` keeps the mark sane. Cosmetic. Not worth a lock table. |
| Google refresh token expired, so mail and calendar are unreadable | A recap that covers less than it appears to — **and, worse, a mark that advanced anyway, so that window of mail is never reported by any future recap** | Only the run knows a source failed. Do not diagnose it from the dashboard: `/api/google/status` is owner-only and reports what is on disk, not whether Hermes could read mail this minute. Gate the mark on a run reporting full source coverage, which needs the structured reply of open question 5. If the reply stays prose, **per-source burn is accepted** and should be stated to Aaron in those words, not softened. |
| Recap reports a `failed` item once and never again | The boss stops seeing an unaddressed failure | Report `failed`, `proposed`, `modifying`, stalled `executing` and open `priority = 'high'` items by current state, unconditionally, not by window. |

The double-trigger row previously leaned on "Hermes' native idempotency". **That
claim is dropped.** Hermes' answers say idempotency is *supported*, not
configured, and relying on it implies an idempotency key that `/api/recap` would
have to generate and send — which this design does not specify. `disabled` plus
`greatest()` is enough for a cosmetic duplicate; if a key is wanted later it is
its own small piece of work.

### Open questions — Aaron's calls

1. **First-run window — 24 hours or 7 days — and how far forward do upcoming
   meetings look?** 24h keeps the first recap readable; 7d is likelier to contain
   the thing actually missed on a box that has been running a while. The forward
   horizon is the same decision pointing the other way: 24 hours, 48, or to the
   end of the working week — 24 keeps a daily recap tight and tells a boss
   nothing about Wednesday's board meeting. Both are baked into the route, so
   decide before the migration.
2. **Can Hermes stamp `profiles.last_seen_at` with a timestamp we supply**, in
   the same service-role write that inserts the recap reply? This is the
   load-bearing one. The statement to ask about is
   `update public.profiles set last_seen_at = greatest(last_seen_at, <the exact
   value supplied>) where id = <caller>` — "stamp this exact value, and never
   lower the mark", not "stamp `now()`", which reopens the hole described above.
   If yes, the mark is correct by construction. If no, the `/api/recap/seen`
   fallback attests arrival rather than generation and is measurably weaker. Ask
   the box.
3. **Can Hermes define a custom read-only toolset**, or only compose the three
   named built-ins — and **is Aaron willing to add a third route** with a third
   secret to store and rotate? None of the three built-ins is right for a recap.
   If custom toolsets are unavailable, the recap ships without mailbox or
   calendar access, which also removes upcoming meetings.
4. **Do assistants get mailbox and calendar read tools?** Build-order step 1,
   still open. The recap forces it, and the terms are: the box holds one Google
   credential, the owner's, so an assistant recap that reads mail reads the
   owner's mail with the owner's token.
5. **Does the recap reply come back as prose, or as something structured?**
   Everything about reporting a partial read honestly — "I could not reach your
   mail" — depends on this, and prose is the default. It is more than a
   presentation question: without a structured signal naming which sources the
   run actually read, the mark cannot be gated on full source coverage, so a run
   whose Google token expired advances the mark anyway and burns that window of
   mail permanently. If it stays prose, the empty-versus-failed distinction lives
   entirely in Dovis's own words, cannot be enforced from this side, and
   per-source burn is accepted.
6. **Does anything reach Supabase when a run fails on the box?** If Hermes writes
   only successes, the dashboard can never distinguish *failed* from *still
   running*, and every failure degrades to a timeout. A failure row is worth more
   than any amount of client-side timeout tuning.
7. **Whose timezone does the body use?** The header is formatted in the viewer's
   timezone; "your 3pm meeting" is generated on the VPS. Without an explicit
   timezone in the payload the two can disagree inside one message.
8. **What does the trigger do in demo mode** — is it absent, does it render
   `recap.unavailable`, or is a clearly labelled sample recap acceptable? This
   sits closest to the do-not-fabricate line, and the state table above leaves
   all three open rather than quietly ruling two out.
9. **Is there a client-rendered empty state?** Aaron listed empty as an explicit
   state; this design recommends removing it, because the dashboard cannot tell
   *looked and found nothing* from *never looked*. That reverses an instruction,
   so it is his call rather than a decision made here.
10. **Does the owner's recap surface assistants' unresolved conversations?** RLS
    permits it. The recommendation is no — auditable on inspection is not the
    same arrangement as pushed into the principal's daily briefing — but it is a
    product decision with a privacy edge, and the parent document's reasoning
    about telling assistants they are visible applies directly.
11. **Is there an "I'm caught up, stop telling me" control?** The design above
    says the mark advances only when a recap is generated. A dismiss button would
    be a second writer with different semantics and needs a deliberate yes or no.
12. **Is `/api/payload/[id]` intentionally role-blind?** It calls only
    `requireProfile()` with no `permissionsFor()` check, so any active account can
    read any drafted email body by id. The demo copy ("Sees everything, decides
    nothing") suggests intent. If it is intended, an assistant recap containing
    queue detail leaks nothing new. If not, it is a live disclosure independent of
    this feature, and the recap must not widen it.

### Where it sits in the build order

After step 3 of the list above, not before it. Steps 2 and 3 build the tables and
the transport this feature is a turn inside; the three answers it needs from the
box — the read-only toolset, who stamps the mark and with what value, and whether
a failed run writes anything — should be asked at the same time as step 1's
mailbox question, because they are all questions for the same box and all of them
change what gets built.

**Send the corrected schema with those questions.** `WEB-CHAT-DESIGN.md` renamed
the column to `author_id` and explains why; Hermes' integration answers §9 still
specify `owner_id` on both tables. If Aaron asks the box to write a stamp and
insert replies without that correction travelling alongside, Hermes will build
against a column name that does not exist.

The migrations are small and belong with the chat migration rather than a later
one, so `profiles` and `todos` are each altered once: `profiles.last_seen_at`,
`todos.decided_at`, the `todos.created_at` not-null fix, and the one-line
tightening of the `"owner updates"` policy on `profiles` to carry
`and id <> auth.uid()`, mirroring `"owner deletes"`.
