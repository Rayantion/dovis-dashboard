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
2026-09-03, alongside the chat itself, and settled ten of its twelve open
questions on 2026-09-05. Those answers are folded into the body below rather than
left in a list at the foot; what remains at the foot is genuinely still open.

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

That ordering is not a formality. One of the three hard problems below — which
route the run executes on — is still decided by how the Hermes routes are built.
The other two, where the success signal comes from and who writes it down, were
decided on 2026-09-05 and are settled here.

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
insert the user's turn; take the window-open stamp from that inserted row;
assemble the queue delta and the caller's own unresolved threads; resolve the
timezone; then forward to Hermes, naming the caller's profile and the turn this
run answers. The insert happens before the forward, matching what `/api/chat`
already has to do.

It returns, to the browser: the window that turn opened, whether this was a first
run, and the id of the turn itself. **The window is what the browser holds**, for
this run's header and nothing else. The turn id is useful to it — a reply that
names that turn is provably *this* run's reply rather than a stale one — but
**the turn id's durable job is not in the browser at all.** It travels to Hermes
with the request and comes back on the reply, so that closing the window is a
property of the rows rather than of the tab that opened it. Why that distinction
carries weight is worked out under the confirmation route below.

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
timestamp is the value the confirmation route will later write as the new floor.
A turn that is not a recap request must not be allowed to mint that stamp, or an
ordinary question answered on the recap route silently burns the boss's period
when its reply lands.

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

comment on column public.profiles.last_seen_at is
  'THE FLOOR. Where the next recap''s window starts. Holds the created_at of the '
  'user turn that OPENED the last confirmed recap — deliberately before the model '
  'ran, so rows written during the run are re-reported rather than skipped. NULL '
  'means no recap has ever completed for this account. Written only by '
  '/api/recap/seen, and only for a reply whose result is success or empty.';

comment on column public.profiles.last_scan_at is
  'THE PROOF SOMEBODY LOOKED. Holds the created_at of the REPLY row of the last '
  'confirmed recap — the latest possible instant, because this is the number the '
  'words "checked just now" refer to. NULL means no recap has ever completed, '
  'which is how the UI tells "nothing new" from "never run" — and which stays '
  'true only because the browser reconciles an unconfirmed reply on thread load. '
  'Advances on an EMPTY result exactly as on a successful one; never on an error. '
  'Nothing is ever queried against it, which is why it may safely hold the later '
  'timestamp.';

comment on column public.profiles.timezone is
  'IANA zone name (e.g. Asia/Taipei) used to render every time in a recap, header '
  'and body alike. The explicit fallback for when the account''s Google Calendar '
  'zone is unavailable — which is the path this deployment runs on today, because '
  'the dashboard''s own Google OAuth is unconfigured and the box''s credential is '
  'not visible from here. The VPS timezone is never used and never inferred.';
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

Both are nullable with no default. A default of `now()` would make the very first
"Catch me up" cover zero elapsed time, which is the one run where the window
matters most. NULL on `last_seen_at` means *no prior review*, the route
substitutes the first-run window decided below, and the header states the window
that was actually used rather than a fixed sentence. NULL on `last_scan_at` means
*nobody has ever looked*, which is one of the two empty messages Aaron asked for.

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
the marks. That one line belongs with the migrations at the foot of this section.

**Do not, separately, add a client policy to make the browser a legitimate
writer.** Postgres RLS cannot restrict which *columns* an UPDATE touches, so a
self-update policy on `profiles` is a self-update policy on `role`, and that is
the worst line available in this codebase. The established shape is already in
the repo: `/api/auth/password-changed` writes under `service_role` after
`requireProfile()` succeeds, with no client policy at all. The marks follow it.

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
measurably weaker fallback. That recommendation is reversed.** Aaron's
instruction is that the authenticated dashboard server writes it. The reasoning
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

**One id, and never a timestamp.** An earlier draft had the client pass the recap
row's `created_at` directly, which hands a buggy or hostile client the ability to
send any future timestamp and permanently blank a window — the failure above, on
demand. `requireProfile()` establishes *who is calling*, not *what they may claim
about a row*, and this repo makes that distinction carefully everywhere else. The
route derives every value it writes.

**The reply names its own turn, and that is what makes the pair safe.**
Server-side, after `requireProfile()`, under `service_role`: load the reply by
id; reject unless it is `role = 'dovis'` and carries the caller's own
`author_id`. Read `meta.turn_id` — the id `/api/recap` sent to Hermes, echoed
back on the reply — and load that row; reject unless it is `role = 'user'`,
carries the same `author_id`, sits in the same conversation, and has a
`created_at` strictly earlier than the reply's.

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

**If Hermes cannot echo the id, require adjacency instead.** Derive the turn as
the newest `role = 'user'` row in that conversation older than the reply, and
reject the confirmation if any other `role = 'user'` row sits strictly between
the two. That is weaker in exactly one way — it refuses a legitimate confirmation
whenever the boss typed while the run was in flight — but it refuses rather than
guesses, so it fails toward not advancing, and the next recap simply repeats the
period.

Deriving the pair from the reply also gives the confirmation a durable home.
Nothing depends on the tab that started the run still being open: any load of the
thread can reconstruct the pair, which is what makes the reconciliation below
possible at all. Then read the result the reply carries, and on `success` or
`empty` only:

```sql
update public.profiles
   set last_seen_at = greatest(last_seen_at, <turn.created_at>),
       last_scan_at = greatest(last_scan_at, <reply.created_at>),
       timezone     = coalesce(<zone named on reply.meta>, timezone)
 where id = <the caller's profile id>;
```

One statement, so the two marks can never disagree about whether a run happened.
The third assignment is a cache rather than a mark — it is what makes the
timezone fallback self-healing, described below — and `coalesce` in that
direction means a reply that names no zone is a no-op and can never blank a good
one. The route returns all three values, and the browser patches its session from
that response, which is authoritative because the route has just written it.

**Note what the floor takes.** It is the *turn's* timestamp, not the reply's,
even though the reply is the row being confirmed and is sitting right there in
the same query. That is the whole (T1, T2] argument above, and it survives the
reversal untouched: writing the reply's `created_at` as the floor would
reintroduce the silent hole on the branch that now actually ships. The reply's
timestamp goes to `last_scan_at`, where nothing is ever compared against it.

**Aaron's decision that the reply carries an explicit result repairs most of what
made this path weaker.** The old objection was precise and fair: this route
attests *arrival* rather than *generation*, so a reply landing proved a row
existed but not that a recap had been produced. With an explicit
`success | empty | error` on that row, it proves both. **The route refuses to
advance either column on `error`, and treats a missing or unrecognised result as
`error`.** A run whose Google token had expired no longer moves the floor, so
that window of mail is re-covered by the next recap instead of being lost. That
is the gate the earlier draft could only ask for, and it is the reason the
"weaker" verdict no longer stands.

**The residual, stated rather than hidden: if no browser ever confirms a reply,
the marks do not advance — and the cost is not the same on the two columns.** On
`last_seen_at` it is repetition: the next recap covers a period the boss has
already read, which is the benign direction. On `last_scan_at` it is worse,
because that column is what the idle line reads. NULL would stop meaning *no
recap has ever completed* and start meaning *no confirmation has ever completed*,
so a first-ever recap whose reply was never confirmed leaves the dashboard
printing "No recap has been generated yet." directly above the recap it
generated. That is exactly the conflation Aaron's decision of 2026-09-05 exists
to prevent, arriving through the transport instead of through the result. The
90-second refetch does not rescue it: in the failure being described the socket
is the thing that is down, that single refetch has already fired and found
nothing, and nothing fires again.

**So the confirmation is not tied to the run that launched it. On loading the
recap thread, the browser reconciles.** If the newest `dovis` reply in that
conversation carries a result and is newer than the session's `last_scan_at`, the
browser posts that reply to `/api/recap/seen` there and then. The route runs the
same checks, derives the same pair from the same `meta`, and `greatest()` makes a
repeated confirmation a no-op. A reply that was missed while the socket was down
is therefore confirmed on the next page load, both columns converge, and the
comment on `last_scan_at` stays true.

With that in place the residual really is repetition, and only until the next
load: a reply that lands unseen leaves the next recap covering a period already
read. That fails **safe** — repetition, never a hole — and it is now a named
property of the design rather than a gap in it. The 90-second refetch is what
keeps even that rare within a session.

**The reversal also shrinks what Hermes has to be trusted with, which is worth
saying plainly.** The old recommendation required a Hermes-side contract that did
not exist, in the same class as the two assumptions this document has already had
to retract — per-request toolsets, and Telegram persistence. What remains is
smaller: Hermes must be told which profile it is answering for, so the reply row
carries the right `author_id` and the run scopes to the right account, and it
must put the result — and the id of the turn it answered — on the reply. None of
that is a stamp into `profiles`, and none of it gives the box write access to the
account table.

**Being told the profile id is still a field that has to be added, and so is the
turn id.** Neither `WEB-CHAT-DESIGN.md` nor Hermes' integration answers describe
either one crossing the wire — step 2 says the route forwards "the last N turns",
and Hermes' §2 step 4 says the same. So `/api/recap` sends both and Hermes accepts
them; the echo is what the confirmation route reads back.

**Where the result lives.** One nullable column on the table the chat migration
already creates:

```sql
-- Belongs in the chat migration, with the table it sits on.
alter table public.messages
  add column if not exists meta jsonb;

comment on column public.messages.meta is
  'Structured sidecar for a Dovis reply; NULL on ordinary turns. A recap reply '
  'carries {"result":"success"|"empty"|"error","turn_id":"<the user turn this run '
  'answers>", ...}; content stays the prose. This column streams over Realtime '
  'with its row, so it must never hold anything the select policy does not '
  'already permit — no payload bodies, no filesystem paths, no secrets.';
```

`content` remains the reply's prose, which is what the transcript shows and what
search indexes. `meta.result` is what the confirmation route and the UI branch
on, and `meta.turn_id` is what makes the pair derivable. Aaron's decision of
2026-09-05 is exactly this split: **Hermes returns structured data internally,
and the dashboard renders concise natural-language prose in the chat.** The two
can never contradict each other, because the structure decides which sentence
gets rendered.

**Webhook failure handling is explicit and durable, per Aaron 2026-09-05, and it
is a Hermes-side requirement that does not exist today.** A run that fails on the
box must still write a row, carrying `result: "error"`. Without it a failure is
indistinguishable from a run still in flight, every failure degrades to the
90-second timeout, and the marks stay put for the right reason by accident rather
than by design. It also follows that **a successful webhook response is not
evidence the Supabase write happened** — the acknowledgement says the run was
accepted and nothing more, so the persistence needs its own retry and its own log
on the box. This retires what was previously open question 6.

#### What a partially blind run does to the floor

The floor is one timestamp covering every source, and that is where the remaining
hole is. A recap whose Google refresh token has expired can still produce a
perfectly readable reply about the queue. If that reply reports `success`, the
floor advances, every mail item in (previous floor, T0] sits below every future
floor, and **no recap ever reports it** — the same silent hole as the T2 error,
arriving on the mail axis instead of the timing axis, and the likeliest of the
three to actually happen, because an expired refresh token is routine.

The gate above closes this **only if a partially blind run reports `error` rather
than `success`.** That is the one thing the three-value result does not settle by
itself, and it is question 2 at the foot. The rule this design needs is a
sentence long: *a run that could not read a source it was asked to read is an
`error`, however much of the rest it managed* — or the result carries a
per-source coverage field and the route requires full coverage before advancing.
Either shape works. What does not work is a `success` that quietly means "most of
it".

Until that is confirmed, per-source burn is still possible, and it should be said
in those words rather than softened into "covers less than it appears to" in a
mitigation column.

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

- **The window `/api/recap` returns is per-run state**, held for that run's
  header and nothing else. It is what the pending bubble and the delivered reply
  are labelled with, and it never touches the session.
- **`session.profile.last_seen_at`, `last_scan_at` and `timezone` are patched
  only from the `/api/recap/seen` response**, which returns exactly what it
  wrote — including on the reconciliation call, which is that same route. There
  is no second path and no inference: if no confirmation happened, or the route
  refused to advance, the session keeps the old values, which is the truth.

The patch itself is the idiom `changePassword` already uses:

```ts
setSession((s) =>
  s
    ? { ...s, profile: { ...s.profile, last_seen_at: seen, last_scan_at: scan, timezone: zone } }
    : s,
);
```

`Profile` in `src/lib/types.ts` gains `last_seen_at: string | null`,
`last_scan_at: string | null` and `timezone: string | null` in the same change —
that file's own comment requires it to mirror the schema exactly. **That will
break the build until the fixtures are updated, which is the point:**
`demoProfiles` in `src/lib/demo-data.ts` is typed `Profile[]` and built from
plain object literals, so three new required fields fail `tsc` there immediately.
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
forward for meetings.** Aaron settled both halves of what was open question 1
together, which is right, because they were always the same product-visible span
pointing in opposite directions.

Seven days back rather than twenty-four hours, because the first run is the one
where a short window is least defensible: a box that has been running for a while
has a backlog, and a first recap covering a single day quietly withholds the
thing the boss most likely missed. It is only ever the first run — every later
run starts from `last_seen_at`, which after a daily habit is a day.

Seven days forward because a recap that stops at tonight's calendar tells a boss
reading it on Monday nothing about Wednesday's board meeting, and "upcoming
meetings" was in the original ask precisely so it would. Both numbers belong to
`/api/recap` rather than to a prompt: the forward horizon is asked for explicitly
on every run, and the backward floor is computed as `T0 - 7 days` when
`last_seen_at` is NULL.

The header must state whichever window was actually used, which is why
`sinceFirst` interpolates a date rather than carrying "the last 7 days" as a
literal. The forward half is the same argument pointing the other way, twice
over: `recap.ahead` interpolates the horizon rather than spelling "7" into two
dictionaries, and it renders only for a run that actually had calendar read — see
the UI states table and the assistant section. If the constant ever changes, the
copy stays true without being touched; if the calendar is not there, the copy
does not claim it was.

### Timezone — decided 2026-09-05

Every time a recap prints — the period header on this side, and "your 3pm
meeting" in the body — is rendered in **the authenticated user's Google Calendar
timezone**, falling back to an **explicit per-profile timezone**. The VPS
timezone is never used, and must never be reached by omission. That was open
question 7, and the failure it names is real: a header formatted in the viewer's
browser zone above a body generated in the box's zone is one message disagreeing
with itself about when a meeting is.

**Today the first tier is unverified from this side, which is why the fallback
column ships now rather than later.** `/api/health` reports `google:false`, and
an earlier draft read that as "there is no Google credential on the box". It does
not say that. The flag is
`Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI)` — a
statement about the **dashboard's own** OAuth client configuration on Vercel, not
about whether a refresh token exists anywhere. It means the dashboard cannot go
and read a calendar timezone itself. It says nothing about the box, and the box
plainly does hold a Google credential, because Dovis reads the mailbox on
Telegram today — which the injection section below relies on. The endpoint that
reports a credential is `/api/google/status`, whose `token` field is an existence
check on the token file, and which is owner-only. So the honest statement is that
the Google tier is unverified from here rather than dead, and `profiles.timezone`
earns its place in the migration list on that weaker but sufficient ground.

So `/api/recap` resolves a zone before forwarding and **always sends an explicit
IANA name** — Hermes is never left to infer one, which is the only way "never the
VPS timezone" can be enforced rather than hoped for. Resolution order: the
account's Google Calendar zone when Google is connected; otherwise
`profiles.timezone`; otherwise the zone the browser resolved and sent with the
trigger. That last tier is a display preference rather than an authority, which
is why it is safe to accept from a client in a way a timestamp is not — and when
it is used, the header names the zone via `recap.timesIn`, so a wrong guess is
visible rather than silent.

The header is then formatted **in that same zone**, by passing `timeZone` into
`toLocaleString` explicitly rather than letting it default to the browser's. A
header in Taipei time above a body in Taipei time is one message; a header in the
viewer's laptop zone above a body in the account's zone is the bug this decision
exists to prevent, reintroduced by a missing option.

When the Google tier does fire, the zone the run used comes back on `meta`, and
the third assignment in the confirmation route's statement caches it into
`profiles.timezone` alongside the marks — so the fallback self-heals and only the
first run on an account can use a stale zone. That clause is a no-op on every
reply that names no zone, which today is every reply, so it should read as
obviously inert rather than as live behaviour.

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

**Whether that toolset can be built is unverified and load-bearing.** Confirmed
2026-09-05: Hermes supports **fixed toolsets per webhook route**, not arbitrary
per-request toolsets — so the enforcement shape is right, and the question left
is only what may be composed into one route. `hermes-telegram` is far too wide.
`hermes-webhook` has no mail or calendar read at all, and adds outbound web
fetch, which is the one capability an injection-summarising run should not have.
Neither is right on its own. If a custom read-only composition is not definable,
**the recap degrades to the queue and conversation delta with no mailbox and no
calendar** — smaller, still honest, still worth shipping. Note what that now
costs: it takes upcoming meetings with it, and upcoming meetings are the thing
the seven-day forward horizon was just decided for. On that fallback
`recap.ahead` must not render either, for the reason the assistant section gives.

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

### What an assistant's recap can contain — decided 2026-09-05

**Assistants get no Gmail and no Calendar, and that is now settled rather than
downstream of build-order step 1.** Aaron's instruction is that assistant chat
runs on a fixed restricted route with no Gmail, no Calendar, no write tools, no
memory, no terminal and no MCP — `hermes-webhook` under the `no_mcp` restriction,
which is the `assistant-chat` route the parent document already describes. That
retires what was open question 4, and it retires it in the direction the terms
demanded: the box holds exactly one Google credential, the owner's, so an
assistant recap that read mail would be reading the principal's mail with the
principal's token, under the principal's name, with no per-caller identity to
scope it by.

So an assistant's recap is **the queue plus their own conversations, by
construction rather than by instruction**, and it runs on `assistant-chat` rather
than a fourth route. A recap-specific route beside it would buy nothing: the
existing toolset already has no mail, no calendar and no writes of any kind. The
read-only guarantee there comes from the route the assistant's ordinary chat
already uses, which is the strongest version of it available — one fewer secret,
one fewer thing to misconfigure.

**What that enumeration leaves out is outbound web fetch, which the route does
carry**, and it should not be read as "strictly narrower than anything". The
recap-route section above rejects `hermes-webhook` for the *owner's* recap partly
on that ground — it is the one capability an injection-summarising run should not
have — and an assistant's recap is a summarising run over externally influenced
text too, since queue titles are derived from the principal's email, as
`schema.sql` says in as many words. It is accepted here for two reasons, and
neither is that the capability is absent: Aaron's instruction binds assistant
chat to this route, and an assistant already reaches exactly this toolset through
their ordinary chat, so the recap turn adds no reach they did not have a sentence
earlier.

**Note the toolset does not supply even the queue.** `hermes-webhook` has no
database read of any kind. So an assistant's queue delta and their own unanswered
turns have to be assembled by `/api/recap` under the caller's own identity and
forwarded as context, the same way the last N turns already are. The toolset is
what makes the recap unable to reach *further*; it is not what makes it able to
reach the queue.

**And that assembly is now permission-bearing, because `/api/payload/[id]`
changed on 2026-09-05.** What was open question 12 — is that route intentionally
role-blind? — has been answered by the code rather than by Aaron: it now requires
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
absent capability. Now that the read question is answered, the assistant scope
line can finally be written: it describes the queue and their own threads, and
names nothing else. **`recap.ahead` is part of that promise and must not render
on an assistant's recap**: there is no calendar in that run by construction, so a
line reading "Plus anything scheduled in the next 7 days" above it claims a
horizon nothing looked at.

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

**The structured result is not a containment boundary either, and must not be
read as one.** `meta.result` decides which sentence the dashboard renders; it
does not vouch for `content`. A `result: "success"` on a reply whose prose was
shaped by a hostile email is still hostile prose, rendered as escaped text. The
result gates the *marks*, not the *words*.

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
three, so it is stated here rather than buried in a table.

**Decided 2026-09-05: there is no global "I'm caught up, stop telling me"
control**, which was open question 11. A dismiss button would be a second writer
with different semantics — *I have read this* is not *this is resolved* — and one
button that silences a real failure is the exact opposite of what the
unconditional half exists for. Successful recap generation moves `last_seen_at`,
and nothing else does. A per-category snooze may be considered later; if it is,
it needs columns of its own, because a mark meaning *reported* and a mark meaning
*muted* must never be the same number.

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
to make in its own prose: `meta.result` says whether the run completed, not how
it organised its paragraphs, and this design should not pretend otherwise.

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
wanted, that is an actor column and a separate decision, and it is deliberately
not folded into this work.

### Unresolved conversations — decided 2026-09-05

The earlier draft listed these among the contents and never said what one is.

**Definition: a conversation whose most recent `messages` row has
`role = 'user'` and is older than ten minutes.** The boss asked something and
Dovis never answered — a crashed run, a lost webhook, a reply that failed to
insert. The ten minutes exclude a turn that is simply still in flight. It is a
narrow definition on purpose: any looser one ("a thread that trailed off") is
unfalsifiable, and every finished conversation ends with a `dovis` row, so
without the role test the predicate matches nothing or everything.

**The owner's recap does not include assistants' unfinished conversations.** That
was open question 10, and Aaron's answer is no. RLS would permit it — the owner
can read every assistant's conversations — so this is a deliberate narrowing in
the query rather than something the database prevents: `author_id = <the caller>`
on every account, the owner's included. The parent document's own reasoning is
why. An assistant is told they are visible precisely because surprise visibility
is a trap, and *auditable on inspection* is a materially different arrangement
from *pushed into the principal's daily briefing*. Assistants' conversations stay
reachable exactly where they already are: the collapsed **Assistants** folder in
the owner's conversation list, which the owner opens deliberately.

Because this is a query narrowing rather than a policy, it is the kind of rule
that regresses quietly — a later "why not show everything the owner can read?"
would look like a simplification. The check is one line of test and it belongs
with the route: an owner whose assistant has an unanswered turn gets a recap that
does not mention it.

### UI states, and the strings

The recap is a chat turn, so most of what the reader sees is a `messages` row
Hermes wrote. The dashboard owns the trigger, the period header, the two empty
messages, and the states where no reply exists yet.

| State | What is on screen |
|---|---|
| Idle, never run | The quick action in the chat's action row, plus `recap.neverRun`. Chosen by `last_scan_at === null`, **after the bootstrap reconciliation has run** — that column means *no recap completed* rather than *no confirmation completed* only because the reconciliation keeps it true. Not in the Danger zone, not in the header. |
| Idle, run before | The quick action, plus `recap.sinceDate` with `last_seen_at`. |
| Working | The user's turn is in the thread; a pending Dovis bubble with `recap.working`. The trigger is `disabled` while in flight, matching `queue.tsx` and `refresh-control.tsx`. |
| Delivered — success | An ordinary Dovis bubble rendering `content`, with `recap.sinceDate` (or `recap.sinceFirst`) above it — and `recap.ahead` **only when the run actually had calendar read**: never on an assistant's recap, never on the no-calendar fallback of open question 1. Both marks advanced. |
| Delivered — empty | `recap.nothingNew`, interpolating the `last_scan_at` the confirmation route just returned. Rendered from `meta.result`, not from `content`. Both marks advanced. |
| Delivered — error | `recap.runFailed` plus `recap.retry`. **Neither mark advanced**, and the next recap re-covers the period. Never either empty message. |
| No reply yet | After **90 seconds**, refetch the thread once. If still nothing: `recap.noReplyYet` plus `recap.checkAgain`. Neither mark has moved. |
| Failed to send | The POST itself failed — auth, HMAC timestamp outside ±300s, box unreachable. `recap.failed` plus `recap.retry`. Nothing was read and nothing was marked. |
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

**The two empty messages are what the second column is for, and they are now
sentences the dashboard is entitled to say.** An earlier draft recommended
against a client-rendered empty state, on the grounds that "nothing changed since
your last review" is a claim only a run that actually looked can make, and the
dashboard could not tell *looked and found nothing* from *never looked*. **Aaron
answered that on 2026-09-05: support the empty state, and distinguish the two.**
The structured result is what makes it honest rather than a guess —
`meta.result === "empty"` is a run reporting that it looked, so `recap.nothingNew`
restates something the run said instead of inventing it. And
`last_scan_at === null` is a fact about this account's history, not a claim about
a mailbox. The failure the old recommendation feared is now impossible in the
direction that mattered: **an `error` renders `recap.runFailed`, never
`recap.nothingNew`**, because that sentence is gated on a column an errored run
cannot move.

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
  // Rendered only when the run had calendar read. Never for an assistant.
  ahead:        "Plus anything scheduled in the next {days} days",
  working:      "Dovis is catching you up",
  nothingNew:   "Checked {when} — nothing new.",
  neverRun:     "No recap has been generated yet.",
  runFailed:    "Dovis couldn't finish this recap, so nothing has been marked as reviewed.",
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
  // 只有實際讀得到行事曆的那一次執行才會顯示；助理的整理永遠不顯示。
  ahead:        "另外加上未來 {days} 天的行程",
  working:      "Dovis 正在幫你整理",
  nothingNew:   "已在 {when} 檢查過，沒有新的變動。",
  neverRun:     "還沒有產生過任何進度整理。",
  runFailed:    "Dovis 沒能完成這次整理，進度標記維持不變。",
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

**The trigger phrases are dictionary keys, not English literals, and that is the
point.** An earlier draft matched two hard-coded English strings, which means a
繁中 boss typing 「補進度」 falls through to the ordinary route, gets the wide
toolset, gets no period header, and the read-only guarantee silently does not
apply to the entire Chinese half of the product by default. The matcher tests the
normalised turn against the union of every language's list, not just the viewer's
current one, because the toggle is per-viewer and a boss who switches to English
mid-session should not lose his Chinese phrases.

Five register decisions against the shipped dictionary. `quickAction` is
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
able to tell those two apart at a glance.

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
`runFailed`, `sampleTag`, `sampleHeader` and `timesIn`, eight keys that must land
in both dictionaries or in neither. The assertion does **not** check that
`triggers` is non-empty — `string[]` satisfies the type when empty — so one unit
test asserting every language's `triggers[0]` exists is worth the three lines,
since an empty array silently disables typed triggering for that language and
nothing else would notice.

`{when}`, `{zone}` and `{days}` interpolate with `.replace("{when}", …)`, the
same idiom `{n}` already uses in `waitingHeadline`. Both first-run and returning
copy take the same slot on purpose: whatever the first window is set to, the
header states the window that was actually used and cannot claim a period the run
did not cover.

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
get Chinese headings around English prose. The two dashboard-rendered outcomes —
`empty` and `error` — escape this entirely, because they are dictionary strings
rather than model output; only `success` carries the risk. The fix is for
`/api/recap` to forward the viewer's `lang` as a prompt hint — it selects a
prompt, not a toolset, so the route binding is untouched. Worth confirming rather
than assuming.

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

**All four outcomes must announce, not only the successful one.** `success`
announces `recap.sinceDate` or the reply's first line; `empty` announces
`recap.nothingNew`; `error` announces `recap.runFailed`; the 90-second timeout
announces `recap.noReplyYet`. A screen-reader user who hears nothing after an
errored run is left in the worst state this feature can produce — believing a
recap arrived and was empty — which is the same conflation Aaron's decision
forbids on screen, arriving through the audio channel instead.

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
`recap.sampleTag`, for the same reason and with more at stake.

### Responsive, theme, and how it is verified

Also absent from the earlier draft, also explicit in the ask.

The trigger sits in the chat's action row and follows the shipped split: the
visible label may hide below `sm` the way `RefreshButton`'s does
(`hidden sm:inline`), because the `aria-label` carries the full sentence
regardless. The period header **wraps rather than truncates** at 375 — a date cut
off by an ellipsis is worse than a date on two lines, since the whole point of
the line is the exact period. `recap.ahead`, when it renders at all, sits under
it as its own line rather than being appended, so the forward claim is not the
half that gets clipped.

**No new visual language.** The trigger uses the one sparkle identity the parent
document requires of every chat entry point; the recap reply is an ordinary Dovis
bubble; the period header uses existing muted-foreground and border tokens. Both
themes are real here — `chrome.tsx` ships a Light/Dark toggle with `aria-pressed`
on both and `next-themes` is a dependency, so this is not a dark-only product,
and the header and the sample tag must both be checked in each. Per the workspace
rule the visual direction for this surface goes through `stitch-to-shadcn` with
the rest of the chat in build-order step 4; the recap adds one button, two lines
of header and one inline tag, so it inherits that pass rather than needing one of
its own.

Verification, mirroring the parent document's step 5 rather than inventing a
different bar:

- `npx tsc --noEmit` and `npm run build`. The three new `Profile` fields must
  break `src/lib/demo-data.ts` first; a green build before the fixtures are
  updated means the type change was never made.
- Screenshots at **375 and 1440, in both languages**, of idle-never-run,
  idle-with-a-mark, working, no-reply, delivered-success, delivered-empty and
  delivered-error.
- **Run two recaps back to back and confirm the second header shows the first
  run's window-open time.** This is the regression check for the stale-chip bug
  above, and it fails against today's provider.
- **Let a reply land with the tab shut (or the socket closed), then reload the
  thread.** Confirm the reconciliation confirms it on that load, that both
  columns move, and that the idle line never renders `recap.neverRun` above a
  recap reply that is on screen.
- **Type an ordinary question into the recap thread while a run is in flight,
  then let the reply land.** Confirm `last_seen_at` takes the *run's* turn and
  not the typed one — and, on the adjacency fallback, that the confirmation is
  refused rather than guessed.
- **Force `meta.result` to `error` on a reply and confirm both columns are
  unchanged in Postgres afterwards**, and that the surface renders
  `recap.runFailed` and never `recap.nothingNew`. This is the single check the
  structured result exists for.
- **Force `empty` and confirm `last_scan_at` moved, and that the rendered message
  is `recap.nothingNew` with that timestamp in it.** The pair of columns is only
  worth having if this is true.
- Type each phrase in `recap.triggers` for both languages and confirm each one
  produces the same request as the button, and that a near-miss
  (*"catch me up on the Chen thread"*) does **not**.
- An assistant account confirming its recap contains no mail, no calendar and no
  draft bodies — and that `recap.ahead` does not render above it; and an owner
  account confirming its recap does not mention an assistant's unanswered turn.
- Demo mode at both widths: the trigger is present, the sample is labelled in the
  bubble and in the header slot, and no timestamp anywhere claims a real period.
- `curl -sL https://aaron-dovis-dashboard.vercel.app/api/health` — it 307s to
  `dovis.jieren.my.id`, and `demo:false` is the live client instance. Do **not**
  read its `google` flag as a statement about the box: it reports the
  *dashboard's* OAuth client config, and it is `false` today. For the credential
  itself, `/api/google/status` as the owner, whose `token` field reports what is
  on disk. And once the chat PR lands, `hermes:true` is the one that says this
  feature can run at all.

### Demo mode — decided 2026-09-05

Demo mode has no Supabase client, no session, no `messages` and no Hermes.
**Aaron's decision: keep the trigger visible, and label what it produces clearly
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
| Reply lands but the browser never sees it | The next recap repeats a period the boss has already read — and, on a first-ever recap, the idle line claims none has ever been generated while one sits on screen | The browser reconciles on the next load of the recap thread: a resulted reply newer than `last_scan_at` is confirmed then, so the marks converge instead of being lost with the tab. Until that load, repetition — the safe direction. Do **not** fix it by advancing on the acknowledgement. |
| A confirmation pairs a reply with the wrong turn — the boss typed into the recap thread while a run was in flight | A floor that jumped over the run's own window: the silent hole, arriving through mispairing | The pair is never taken from the client. The reply names its originating turn on `meta` and the route rejects anything else; without the echo, adjacency, which refuses rather than guesses. |
| POST rejected — 401, HMAC timestamp outside ±300s, box down | Immediate error on the trigger | `recap.failed` with `recap.retry`. Nothing was read, nothing was marked. |
| The run fails on the box | Without a durable failure row, indistinguishable from a run still in flight | Hermes writes a row carrying `result: "error"` — a requirement, not an assumption. The route refuses to advance either mark and the UI shows `recap.runFailed`. A missing or unrecognised result is treated as `error`. |
| An error rendered as an empty recap | The boss reads "nothing new" about a mailbox nobody could open | Structurally impossible: `recap.nothingNew` is gated on `meta.result === "empty"` and interpolates `last_scan_at`, a column an errored run cannot move. |
| A mark advanced past a recap nobody saw | A window silently absent from every future recap | The failure that actually matters. Advance only on `success` or `empty`, only from the window-open stamp of the turn the reply itself names, only with `greatest()`, and only in the one route that writes them. |
| Triggered twice — button plus typed phrase, or two tabs | Two recaps in the thread, and two confirmations | `disabled` while in flight, per the shipped idiom, and `greatest()` on both columns keeps the marks sane in either arrival order. Cosmetic. Not worth a lock table. |
| A partially blind run reports `success` (expired Google refresh token) | A recap that covers less than it appears to — **and a floor that advanced anyway, so that window of mail is never reported by any future recap** | Not yet closed. Needs a run that could not read a requested source to report `error`, or a result that names its coverage. Open question 2. Do not try to diagnose it from the dashboard: `/api/google/status` is owner-only and reports what is on disk, not whether Hermes could read mail this minute. |
| Recap reports a `failed` item once and never again | The boss stops seeing an unaddressed failure | Report `failed`, `proposed`, `modifying`, stalled `executing` and open `priority = 'high'` items by current state, unconditionally, not by window. There is no mute control, by decision. |
| A sample recap mistaken for a real one | Invented content believed | Three independent signals, per the demo section: the header slot denies a period, `recap.sampleTag` sits inside the bubble, `demoBanner` sits above the page. Bound to `isDemoMode`, never to a missing Hermes. |

The double-trigger row previously leaned on "Hermes' native idempotency". **That
claim is dropped.** Hermes' answers say idempotency is *supported*, not
configured, and relying on it implies an idempotency key that `/api/recap` would
have to generate and send — which this design does not specify. `disabled` plus
`greatest()` is enough for a cosmetic duplicate; if a key is wanted later it is
its own small piece of work.

### Open questions — Aaron's calls

Eleven of the previous twelve are gone: Aaron answered ten of them on 2026-09-05
and they now live in the body above, and `/api/payload/[id]` answered itself when
the route gained its `can_modify` check. One of the original twelve survives, as
question 1 below. The other two are new, and both are consequences of answers
rather than leftovers from before them.

1. **Can Hermes define a custom read-only toolset for `owner-recap`**, or only
   compose the named built-ins — and **is Aaron willing to add a third route**
   with a third secret to store and rotate? Fixed-toolsets-per-route is now
   confirmed as the mechanism; what is unconfirmed is whether a mail-and-calendar
   read composition, without writes and without outbound web fetch, can be built
   at all. None of the three built-ins is right on its own. If it cannot be, the
   recap ships without mailbox or calendar access — which also removes upcoming
   meetings, and with them the forward half of the seven-day window decided
   above, and `recap.ahead` with it.
2. **Does the structured result distinguish a partially blind run from a
   successful one?** `success | empty | error` gates the marks, which closes the
   hole for a run that failed outright. It does not by itself say what a run
   reports when it read the queue but could not open the mailbox. If that is
   `success`, per-source burn returns exactly as before. The ask is one rule —
   *a run that could not read a source it was asked to read is an `error`* — or a
   per-source coverage field on `meta` that the route requires to be complete
   before it advances the floor.
3. **Who sets `profiles.timezone`, and when?** The resolution order is decided;
   the seeding is not. The dashboard cannot read a Google calendar zone itself
   today, so an empty column means every recap falls through to the
   browser-resolved last resort until a run comes back naming one. The
   recommendation is to capture the browser's resolved zone at account creation
   and let the owner correct it on the Team page, which makes the common case
   right without asking anybody anything. It is one field on an existing form, so
   it wants a yes or no rather than a design.

### Where it sits in the build order

After step 3 of the list above, not before it. Steps 2 and 3 build the tables and
the transport this feature is a turn inside. The asks that remain for the box —
the read-only toolset, whether a partially blind run reports `error`, the durable
failure row, and echoing the turn id back on the reply — should be sent together,
because they are all questions for the same box and every one of them changes
what gets built. What is no longer on that list is the stamping contract: **the
dashboard writes the marks, so Hermes is asked only to accept a profile id and a
turn id, and to put the result and that turn id on the reply.**

**Send the corrected schema with those questions.** `WEB-CHAT-DESIGN.md` renamed
the column to `author_id` and explains why; Hermes' integration answers §9 still
specify `owner_id` on both tables. If Aaron asks the box to insert replies
without that correction travelling alongside, Hermes will build against a column
name that does not exist.

The migrations are small and belong with the chat migration rather than a later
one, so each table is altered exactly once:

- `profiles.last_seen_at`, `profiles.last_scan_at`, `profiles.timezone`
- `todos.decided_at`, and the `todos.created_at` not-null fix
- `messages.meta`, which belongs to the chat migration because that is where
  `messages` is created
- the one-line tightening of the `"owner updates"` policy on `profiles` to carry
  `and id <> auth.uid()`, mirroring `"owner deletes"`
