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
- **The caller's role travels with the request** and selects the tool set on the
  box — see below.

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

So `/api/chat` sends the authenticated role to Hermes, and Hermes selects a tool
set from it. An assistant's turn runs with no write tools at all: no todo
creation or mutation, no `draft_email`, no calendar writes.

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
happens, rather than keeping it only in its own memory. This is new work on the
box and the most likely source of friction, because it must happen on every
exchange, not only when the web asks.

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

```sql
Visibility is **asymmetric**, per Aaron 2026-09-03: an assistant sees only their
own conversations; the owner sees everyone's, theirs and every assistant's.

```sql
-- SECURITY DEFINER so the policy does not recurse into profiles' own RLS, and
-- STABLE so Postgres evaluates it once per statement rather than once per row.
create function public.is_owner() returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

create policy "read own, owner reads all" on public.conversations
  for select to authenticated
  using (author_id = auth.uid() or public.is_owner());

create policy "read own, owner reads all" on public.messages
  for select to authenticated
  using (author_id = auth.uid() or public.is_owner());
```

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
- **Debounce belongs on search, not on paging.** Aaron asked for debouncing
  here; the accurate mapping is that *Show 5 more* is a paged fetch (each click
  is one deliberate request, so there is nothing to debounce), while a search
  box over conversation titles is where a debounce genuinely belongs — roughly
  250ms, so typing "insurance" issues one query rather than nine. Both are
  worth having; they are simply different mechanisms and it is worth not
  confusing them in the implementation.

If more than one assistant exists, consider sub-grouping the folder by assistant
rather than interleaving them — five conversations drawn from three people reads
as noise. Left as a refinement, not a requirement.

The list is the piece paddy has no equivalent for — its `ChatHistorySheet` shows
turns within a single capture's thread, not a set of conversations. Expect to
write that one rather than port it.

Per the workspace rule, visual direction for this new surface goes through the
`stitch-to-shadcn` skill and Stitch MCP before components are written. Take the
tokens, not the markup; implementation comes from the shadcn registries.

## Out of scope, recorded so it is not re-litigated

- **STT / TTS runs through Hermes**, configured on the box (Aaron, 2026-09-03).
  Not a dashboard concern. One constraint to carry: the box is 4GB / 2 vCPU, so
  whatever Hermes uses for speech must be a hosted service, not a local model —
  the same budget that rejected a local embedding model.
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
3. **How does Hermes authenticate back to Supabase** to insert its reply —
   service_role held on the box, or a callback into `/api/chat`?
4. **Can Hermes persist every Telegram turn** into `messages` as it happens?
   The merged model depends on it. If it cannot, the Telegram conversation
   simply will not appear on the web and the design degrades to web-only
   conversations — worth knowing before the UI promises otherwise.

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
