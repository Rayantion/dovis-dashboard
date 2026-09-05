# Email intelligence — design

**Status: designed, not built.** Specified by Aaron 2026-09-05, the same day he
settled the assistant permission decisions this design leans on. It adds three
things to an action card derived from email: structured flags about the message,
the attachments that came with it, and the links inside it. It adds no action
type, changes neither `draft_email` nor `manual`, and leaves the owner/assistant
permission model exactly where it is.

---

## What the feature is

A card in the queue today shows a title, a status and, on expand, what Dovis
would send. Every one of those is derived from somebody else's email, and the
card says nothing about the somebody else. A boss can therefore read *"Update the
bank details on invoice INV-4471 before payment"*, recognise the supplier's name,
and press Confirm — with no indication that the message arrived from a gmail.com
address that has never written to him before.

This feature puts what Dovis noticed onto the card. Sixteen structured flags, a
list of attachments the boss can actually open, and the links in the message
shown by where they go rather than by what they are labelled.

Three things it is not, stated first because each is a request that will arrive
within a week of shipping.

It is **not a verdict**. There is no green chip, no "looks legitimate", no
"verified safe". A model reading an attacker's prose cannot clear a message, and
a positive safety claim would convert every false negative into an endorsement
by Dovis — printed in the boss's own font, on the one message that was worth
being careful about. The absence of a flag reads as silence, never as clearance.

It is **not an action surface**. No Report phishing, no Block sender, no Trust
this contact. `ADDING-FEATURES.md` §3 already forbids an action type describing
something the executor cannot do, and there is no such tool on the box; a
Report button would be theatre, and the specific harm is a boss who believes
something happened to a scammer. Every control this feature adds is inert:
expand a reason, open an attachment, inspect a link.

It is **not a filter**. Flags never become a control that hides items into a
clean bucket. A queue you can sort by safety is a queue where the dangerous item
is one tap from being out of sight.

---

## What is buildable today, and what needs the box

`ADDING-FEATURES.md` §3 sets the rule this section exists to honour: *"Give the
agent a tool that performs it… Without this, stop — the rest is theatre."* The
dashboard can render anything. It cannot invent a flag, and a flag nothing
produces is a column that stays empty forever.

What this repo establishes about the box is narrow. `src/lib/google.ts` shows
one credential, the owner's, with `gmail.modify` and `calendar`. It shows
`gmail_reply` is off the allowlist. It says **nothing about what the Gmail MCP
tool returns** — no document in this repo describes the tool's payload shape.
So the table below is a set of questions for the box, not a plan.

| Needs | Buildable when | Flags it gates |
|---|---|---|
| Nothing new — the dashboard renders what a row contains | now | none; the schema, types, strings, routes and card can all land against an empty table |
| MIME part metadata (filenames, declared types, part ids) | probably now | `attachment_received`, `pdf_attachment`, `image_attachment` |
| The body as text | probably now | `external_links`, and the four body-derived judgements |
| Raw headers — `Reply-To`, `List-Unsubscribe`, `Precedence`, `Auto-Submitted` | **unverified** | `newsletter_or_marketing`, `receipt_or_automated`, and the honest form of `suspicious_sender` |
| `users.messages.attachments.get` for bytes | probably now, `gmail.modify` covers it | every attachment open, preview and download |
| Message search over the mailbox, one query per proposal | **unverified** | `new_contact`, `new_company` |
| A bounded image decoder to make a preview | **not present, needs building** | the image thumbnail state |

Two of those are load-bearing enough to block parts of the feature rather than
degrade them.

**If raw headers are unavailable**, `newsletter_or_marketing` and
`receipt_or_automated` have no mechanical source. They would then be a model
guessing from prose whether something is a newsletter, which is a judgement
dressed as a fact, and the honest response is to ship without those two codes
rather than promote a guess into the observed tier. The CHECK constraint and the
union can carry all sixteen from day one; the analyser simply never emits two of
them, and the card never shows what nobody wrote.

**If mailbox search is unavailable**, `new_contact` and `new_company` must not be
implemented against the box's own memory instead. "Dovis has not seen this
sender" means every legitimate correspondent is new for the first fortnight, the
flag carries no information at all, and the boss learns to skip the entire panel
— permanently, and in exactly the period when the product is earning his trust.
A flag that is wrong for two weeks costs more than a flag that is absent for two
weeks.

Everything else — schema, types, both dictionaries, the attachment route, the
card, the demo fixtures — can be built and verified now, because demo mode
renders fixtures and never touches a network.

---

## Aaron's decisions, and what they settle here

Recorded 2026-09-05, binding, and each one closes a question this design would
otherwise have to open.

**Assistants get no mailbox or calendar read access at all.** Their Hermes
toolset excludes every Gmail and Calendar tool; they may only discuss data
already surfaced through permitted rows. This settles the attachment question
below and pushes hard on the flag question.

**`/api/payload/[id]` requires `permissionsFor(profile).canModify`** — owner
allowed, assistant with `can_modify` allowed, assistant without it denied. This
is already in the file and pinned by `tests/payload-route.test.ts`; the design
below reuses it rather than inventing a second gate.

**Service-role stays server-side, RLS is preserved, and a role from the browser
is never trusted.**

One premise in the brief is wrong and it changes code, so it is corrected here
rather than quietly worked around. Aaron wrote *"existing dark Dovis visual
style"*. The product is not dark-only. `globals.css` defines the complete
palette on bare `:root` — warm paper `#f7f5f2` with ink-teal type — and `.dark`
as a separately authored block whose own comment reads *"Dark is a real palette,
not an inversion."* `theme-provider.tsx` sets `defaultTheme="system"`, so the
palette a boss opens is his device's, and neither block is the minority case.

The consequence is narrow and real: every colour in this feature is a token
defined in **both** blocks. A caution colour written as a Tailwind palette
literal, or defined only inside `.dark`, is a phishing warning that is invisible
for whichever half of the day the operating system says — which is the worst
available failure for this particular feature.

---

## Where each field lives, and why

The placement argument comes from the posture the schema already holds, not
from convenience.

`todo_payloads` is locked — RLS on, no client policy, absent from the
publication — because it holds *the owner's mail rewritten in the owner's voice*.
`todos` is open to every active account because a title derived from a subject
line is a category of thing the product already streams. Those two precedents
sort every field Aaron listed.

| Tier | What | Gate | Precedent |
|---|---|---|---|
| 1 | Flag codes; analysis state; attachment filename, size, sniffed type, preview state; link URL, label, verdict | `select to authenticated using (public.dovis_can_modify())` | the `can_modify` switch itself |
| 2 | Per-flag evidence; attachment **bytes** and previews | `permissionsFor().canModify` for evidence, **owner-only** for bytes | `todo_payloads` and `/api/payload/[id]` |
| 3 | Gmail message id, Gmail attachment id, preview storage key | RLS on, **no policy**, service_role only | `todo_payloads` itself |

Three consequences worth spelling out, because each is a place someone will
later reach for the obvious thing.

**Nothing is added to `todos`.** That table is `replica identity full` and in the
publication, so every column on it is broadcast in full to every subscribed
browser on every update. Keeping analysis off it is what stops a future "just one
convenience column" from becoming a broadcast. It is also what makes the
`dovis_can_modify()` gate possible at all: `todos` has one select policy for
every active account, so a column there could not be narrower than the table.

**Tier 1 is not `dovis_is_active()`, and that is a change of position from the
obvious reading.** The tempting argument is that a code like `possible_phishing`
discloses strictly less than `todos.title` — *"Reply to Stanley Chen about the Q3
budget shortfall"* — which a read-only assistant already reads. That is true of
one code and false of a set: `payment_or_invoice_request` plus
`sensitive_info_request` plus a filename on an item titled with a person's name
is a summary of mail Aaron just decided assistants may not read.

The reason this costs nothing is the shape of the card. The collapsed caution
chip exists because Confirm renders on a collapsed row — `queue.tsx` gates the
action buttons on `!decided && perms.canModify`, with no dependency on `open`.
A read-only assistant **has no Confirm button**, so the chip has nothing to
protect them from, and its disappearing for them is correct rather than a
degradation. One gate, `can_modify`, covers drafts, flags, evidence, attachment
metadata and links. There is no third permission concept in this feature.

**Attachment bytes are owner-only, which is tighter than `can_modify`.** This is
the one place the design refuses to reuse the existing gate, and the argument is
what `can_modify`'s own consent copy says. `i18n.ts` describes it to the owner as
*"they can confirm, modify and reject items in your queue… Turn this on only for
someone you would let read your inbox"* — and the payload route's docstring makes
the matching argument, that a draft is *"the owner's mail rewritten in the
owner's voice."* An attachment is not a derivative of mail; it **is** mail,
byte-for-byte and unsummarised: a signed contract, a bank statement, a medical
scan, a passport photograph the owner never chose to route through Dovis. Serving
one over HTTP reinstates through a different door exactly the capability Aaron
removed from the Hermes toolset hours earlier.

A `can_modify` assistant therefore sees that an attachment exists, its name, its
size and its type, and cannot open it. The UI says so in words, because a
disabled button with no reason reads as a bug.

---

## The schema

A new section 7 for `supabase/schema.sql`, appended after section 6. Re-runnable
throughout, matching the file's own promise: `create table if not exists`,
`create index if not exists`, `drop policy if exists`, and drop-then-add for
every CHECK so a re-run **updates** a widened constraint rather than silently
keeping the old one.

```sql
-- =============================================================================
-- 7. EMAIL INTELLIGENCE — analysis, flags, attachments
-- =============================================================================
--
-- Everything below describes mail the principal RECEIVED. It is ANALYSIS and
-- METADATA, never instruction.
--
-- The only writer is the analyser on the box, which holds service_role: there is
-- deliberately NO insert/update/delete policy on any table here, so no browser —
-- not even the owner's — can write a flag. A flag is what the dashboard trusts
-- to draw a warning, so a flag a client could write would be a warning a client
-- could forge.
--
-- READS are gated on dovis_can_modify(), the same switch that governs draft
-- bodies through /api/payload/[id]. A read-only assistant sees no analysis at
-- all, which is Aaron's 2026-09-05 decision applied consistently: they have no
-- mailbox access, and a set of flags on a titled item is a summary of mail.
--
-- NOTHING IS ADDED TO `todos`: it is REPLICA IDENTITY FULL and in the realtime
-- publication, so every column on it is broadcast in full to every subscribed
-- browser on every update.
--
-- Note the shape of every block: `enable row level security` comes IMMEDIATELY
-- after the create, not in a distant section. A new table in the public schema
-- of a Supabase project inherits default privileges to anon and authenticated,
-- so it is world-readable in the window between those two lines.


-- ------------------------------------------------------- 7.1 the analysis row
--
-- One row per analysed todo. Its presence is what distinguishes "checked and
-- found nothing" from "never checked" — see the section of the design document
-- with that name. NO row means not analysed; it is not the same as `state`
-- being null, and the UI must not conflate them.
create table if not exists public.todo_email_analysis (
  todo_id      uuid primary key references public.todos(id) on delete cascade,
  state        text not null default 'ok',
  analysed_at  timestamptz not null default now(),
  -- Which sources the run actually read. {"headers":true,"body":true,
  -- "attachments":false,"history":false}. A run that could not reach a source
  -- reports `partial` and names it, rather than reporting `ok` over a hole.
  sources      jsonb not null default '{}'::jsonb,
  -- Inspectable links, in message order. Not a table of their own because
  -- nothing ever addresses one link by id — see the attachments table, which
  -- is one precisely because the byte route resolves a row.
  links        jsonb not null default '[]'::jsonb
);

alter table public.todo_email_analysis enable row level security;

alter table public.todo_email_analysis drop constraint if exists todo_email_analysis_state_check;
alter table public.todo_email_analysis add constraint todo_email_analysis_state_check
  check (state in ('ok','partial','failed'));

alter table public.todo_email_analysis drop constraint if exists todo_email_analysis_links_array;
alter table public.todo_email_analysis add constraint todo_email_analysis_links_array
  check (jsonb_typeof(links) = 'array');

drop policy if exists "read email analysis" on public.todo_email_analysis;
create policy "read email analysis" on public.todo_email_analysis
  for select to authenticated
  using (public.dovis_can_modify());

comment on column public.todo_email_analysis.state is
  'ok      — every source the analyser wanted was read. '
  'partial — at least one source could not be read; `sources` says which. '
  'failed  — the run did not complete. '
  'There is deliberately no ''clean'' or ''safe'' value: this column reports '
  'what the run managed to do, never a verdict about the message.';

comment on column public.todo_email_analysis.links is
  'Array of {url, label, safety}. `url` is the most attacker-controlled string '
  'in this schema and is stored in full, because Aaron requires the reader be '
  'able to inspect it. Rendering it as TEXT is safe; rendering it as an href is '
  'the gated act, and that gate lives in linkTarget() in types.ts. No hostname '
  'is stored: it is parsed from `url` in the browser, so a stored host can '
  'never disagree with the URL that becomes the href — and the host is the half '
  'the reader is being asked to trust.';


-- ------------------------------------------------------------------ 7.2 flags
create table if not exists public.todo_flags (
  todo_id      uuid not null references public.todos(id) on delete cascade,
  code         text not null,
  detected_at  timestamptz not null default now(),
  primary key (todo_id, code)
);

alter table public.todo_flags enable row level security;

-- The closed vocabulary. Sixteen codes, fixed meanings, OURS — not the sender's.
alter table public.todo_flags drop constraint if exists todo_flags_code_check;
alter table public.todo_flags add constraint todo_flags_code_check check (code in (
  -- observed: established by a parser, from headers, MIME structure or the
  -- mailbox's own history. Stated flat, because they are checkable.
  'new_contact','new_company','free_mailbox_sender',
  'newsletter_or_marketing','receipt_or_automated',
  'external_links','attachment_received','pdf_attachment','image_attachment',
  -- inferred: a model's reading of text a stranger wrote. Always hedged.
  'possible_scam','possible_phishing','suspicious_sender',
  'sender_domain_mismatch','urgent_language',
  'payment_or_invoice_request','sensitive_info_request'
));

-- `basis` is GENERATED ALWAYS: the analyser cannot write it, only derive it.
--
-- That is the entire reason it is not an ordinary column. If the box could write
-- basis, it could write ('possible_phishing','mime') and file its own phishing
-- warning under the neutral, unhedged group — an attacker-influenced model
-- quietly downgrading its own alarm. Whether a claim is observed or inferred is
-- a property of the CODE, so it is computed from the code and nothing else can
-- set it.
--
-- The `else` arm is 'model', which is the SAFE default: a code added to the
-- CHECK above and forgotten here renders in the hedged, coloured tier rather
-- than the neutral one. Fail toward caution.
--
-- Dropped and recreated on every run so widening the vocabulary is picked up.
-- `add column if not exists` would keep a stale expression.
do $$
begin
  alter table public.todo_flags drop column if exists basis;
  alter table public.todo_flags add column basis text generated always as (
    case
      when code in ('new_contact','new_company') then 'mailbox'
      when code in ('free_mailbox_sender','newsletter_or_marketing',
                    'receipt_or_automated') then 'header'
      when code in ('external_links','attachment_received',
                    'pdf_attachment','image_attachment') then 'mime'
      else 'model'
    end
  ) stored;
end
$$;

create index if not exists todo_flags_todo_idx on public.todo_flags (todo_id);

drop policy if exists "read flags" on public.todo_flags;
create policy "read flags" on public.todo_flags
  for select to authenticated
  using (public.dovis_can_modify());
-- No write policy, on purpose. See the section header.

comment on table public.todo_flags is
  'Codes only — a closed set the dashboard can translate. The words a boss reads '
  'are written by us in i18n.ts and looked up by code, so a sender cannot author '
  'their own headline. The explanation is on todo_payloads.flag_evidence, as '
  'typed facts rather than prose, and is gated the same way draft bodies are.';

comment on column public.todo_flags.basis is
  'Where the claim came from, derived from the code. mailbox/header/mime are '
  'observed — a parser established them and the label states them flat. model '
  'is inferred — a model read the sender''s text, so the label hedges and the '
  'chip carries colour. The UI derives its whole treatment from this and never '
  'from the code, so a seventeenth code cannot ship asserting certainty by '
  'accident.';


-- ---------------------------------------------- 7.3 evidence for an inferred flag
--
-- Keyed by todo_flags.code, values are the typed objects in FlagEvidence
-- (types.ts). The dashboard composes the sentence from a dictionary template and
-- these slots; the analyser never writes a sentence.
alter table public.todo_payloads
  add column if not exists flag_evidence jsonb not null default '{}'::jsonb;

-- The SHAPE is ours, so it is checked: a malformed write is our bug and should
-- fail loudly. The VALUES are attacker-influenced and are NOT checked — see 7.4.
alter table public.todo_payloads
  drop constraint if exists todo_payloads_flag_evidence_object;
alter table public.todo_payloads add constraint todo_payloads_flag_evidence_object
  check (jsonb_typeof(flag_evidence) = 'object');

comment on column public.todo_payloads.flag_evidence is
  'Per-flag evidence for INFERRED flags, keyed by todo_flags.code. Facts, not '
  'prose: {"sender_domain_mismatch":{"claimed":"Acme","domain":"gmail.com"}}. '
  'It lives here rather than beside the flags because it is derived from the '
  'mail body, which is the same class as a draft, and it therefore inherits '
  'this row''s gate with no new access-control surface. A model that emits '
  'sentences instead of slots is emitting attacker-shaped prose into a field a '
  'later model will read as trusted analysis — see the untrusted-content rules.';


-- ------------------------------------------------------------- 7.4 attachments
create table if not exists public.todo_attachments (
  id             uuid primary key default gen_random_uuid(),
  todo_id        uuid not null references public.todos(id) on delete cascade,
  position       int  not null default 0,
  filename       text not null,
  mime_declared  text,
  mime_sniffed   text,
  size_bytes     bigint check (size_bytes is null or size_bytes >= 0),
  kind           text not null default 'other'
                 check (kind in ('image','pdf','other')),
  preview        text not null default 'none'
                 check (preview in ('ready','none','failed')),
  created_at     timestamptz not null default now()
);

alter table public.todo_attachments enable row level security;

create index if not exists todo_attachments_todo_idx
  on public.todo_attachments (todo_id, position);

drop policy if exists "read attachments" on public.todo_attachments;
create policy "read attachments" on public.todo_attachments
  for select to authenticated
  using (public.dovis_can_modify());

comment on table public.todo_attachments is
  'Metadata only. There is NO url column here and there must not be one: the '
  'browser addresses an attachment by this row''s id (/api/attachment/[id]) and '
  'the route resolves the locator from todo_attachment_sources with service_role. '
  'A url column would be a locator in a browser-readable table by another name. '
  'This row is readable with can_modify; the BYTES are owner-only, so a row '
  'being visible is not permission to open it.';

comment on column public.todo_attachments.filename is
  'SENDER-CHOSEN, therefore attacker-controlled: expect double extensions, '
  'right-to-left overrides, hundreds of characters. Stored VERBATIM so the row '
  'is not lying about what arrived; sanitizeDisplay() strips and clamps it at '
  'render. DELIBERATELY UNCONSTRAINED — a length CHECK here would let a sender '
  'make the insert fail, which is a way to erase the record of their own '
  'attachment.';

comment on column public.todo_attachments.mime_declared is
  'What the message part claimed. Untrusted. Kept only so a disagreement with '
  'mime_sniffed is inspectable. NEVER used to choose a renderer or a header.';

comment on column public.todo_attachments.mime_sniffed is
  'What the box measured from the leading bytes. The trusted one. `kind` derives '
  'from this alone, which is why a .exe named invoice.pdf lands as ''other''.';

comment on column public.todo_attachments.preview is
  'ready  — the box holds a derived, re-encoded preview. '
  'none   — no preview is possible for this type (a .docx). Not an error. '
  'failed — the box tried and could not: corrupt, encrypted, oversized. '
  'none and failed must stay distinguishable: "we do not preview spreadsheets" '
  'and "this PDF is broken" tell the reader different things.';


-- ------------------------------------- 7.5 attachment locators — TIER 3, no policy
create table if not exists public.todo_attachment_sources (
  attachment_id  uuid primary key
                 references public.todo_attachments(id) on delete cascade,
  provider       text not null default 'gmail' check (provider in ('gmail')),
  message_id     text not null,
  part_id        text,
  remote_id      text not null,
  -- The DERIVED preview only. Content-addressed, on the box. Originals are
  -- never written to disk — see "Retention" in the design document.
  preview_key    text check (preview_key is null or preview_key ~ '^[0-9a-f]{64}$'),
  fetched_at     timestamptz
);

alter table public.todo_attachment_sources enable row level security;

-- NO POLICY, ON PURPOSE — the todo_payloads posture, for the same reason.
-- RLS enabled plus no matching policy = deny; service_role has BYPASSRLS and
-- needs none, so a policy here would be inert as well as wrong.
--
-- remote_id is the Gmail attachment id and message_id identifies the mail
-- itself. Neither is redeemable without the owner's OAuth token, so neither is
-- a bearer credential — but both are internal structure of the principal's
-- mailbox, and a URL carrying them leaks through Referer, browser history,
-- screenshots and pastes. The route returns the FILE, never the locator.
-- Do not "fix" this by adding a policy.

comment on table public.todo_attachment_sources is
  'Service-role only. Same rule as todo_payloads: RLS on, no client policy, and '
  'absent from the realtime publication.';

comment on column public.todo_attachment_sources.provider is
  'One value on purpose. Adding a provider means adding a fetcher on the box '
  'first; widening this CHECK without one produces rows nothing can serve.';


-- --------------------------------------------------------------- 7.6 realtime
--
-- None of these tables joins supabase_realtime, and `todos` is unchanged, so
-- what streams to a browser is EXACTLY what streamed before this section
-- existed.
--
-- That is a decision, not an omission. dovis-provider already holds INSERTs
-- behind the "queue changes waiting" banner rather than applying them, with a
-- comment naming the hazard: a row landing while the owner reaches for Confirm
-- shifts every row down one and they approve the wrong item. Streaming flags
-- would reintroduce that hazard in its worst form — a "Possible phishing" badge
-- landing on a card mid-approval, or four seconds after it was approved. Flags
-- arrive with the snapshot of the queue they belong to.
--
-- The client therefore fetches these tables in fetchAll() alongside todos and
-- widgets, and a late flag appears on the next refresh. That is the contract the
-- queue itself already has. Note that a status UPDATE applies from payload.new
-- without touching flag state, which is keyed separately by todo_id — so a row
-- going proposed → confirmed keeps its flags on screen.


-- -------------------------------------------------------------- 7.7 deletion
--
-- No new code in the danger zone. Every table here cascades from public.todos
-- exactly as todo_payloads does, so /api/queue/clear-completed and
-- /api/queue/delete-all already take analysis, flags and attachments with them,
-- and todo_attachment_sources cascades from todo_attachments so the chain
-- reaches the locators. Verify after the first real delete rather than assuming:
--
--   select count(*) from public.todo_attachment_sources s
--    where not exists (select 1 from public.todo_attachments a
--                       where a.id = s.attachment_id);   -- must be 0
--
-- What the cascade CANNOT reach is the derived preview files on the box. See
-- "Retention, and a promise the danger zone currently makes" below: those need
-- a reaper, and the danger-zone copy needs a sentence in both languages.
```

One thing about `todos.source`. It is declared `source text` with no CHECK, so
nothing guarantees the string `'email'` is one of a known set. This feature keys
a whole card section off it. Do **not** trust it to be well-formed: treat any
value other than the literal `'email'` as not-email and render no section.
Adding a CHECK is a reasonable separate tidy-up and is not folded in here,
because it would fail the migration on any existing row carrying something else.

---

## The TypeScript

Additions to `src/lib/types.ts`, changing in lockstep with the SQL. That file's
own header states the rule: *"These types mirror `supabase/schema.sql` exactly.
If you change one, change both."*

```ts
/* ------------------------------------------------- email intelligence (§7) */

/**
 * The closed vocabulary of §7.2. Sixteen codes, fixed meanings.
 *
 * Closed, not free text, and the CHECK constraint is what makes it true. The UI
 * translates by key lookup, so a code the dashboard cannot translate is a code
 * it cannot render. Adding one means: the CHECK in schema.sql, this union,
 * FLAG_BASIS below, and FLAG_LABELS in i18n.ts for BOTH languages. Miss any and
 * the build or the insert fails, which is the intended failure.
 *
 * Order here is display order within a group.
 */
export type EmailFlagCode =
  // observed
  | "new_contact"
  | "new_company"
  | "free_mailbox_sender"
  | "newsletter_or_marketing"
  | "receipt_or_automated"
  | "external_links"
  | "attachment_received"
  | "pdf_attachment"
  | "image_attachment"
  // inferred
  | "possible_scam"
  | "possible_phishing"
  | "suspicious_sender"
  | "sender_domain_mismatch"
  | "urgent_language"
  | "payment_or_invoice_request"
  | "sensitive_info_request";

/** Where the claim came from. `model` is the only inferred one. */
export type FlagBasis = "mailbox" | "header" | "mime" | "model";

/**
 * Mirrors the GENERATED ALWAYS expression on todo_flags.basis, and must be
 * edited with it. `Record<EmailFlagCode, …>` makes a missing entry a compile
 * error, the same way the CHECK makes a missing arm an insert error.
 *
 * The UI derives every treatment from this — wording tier, colour, whether a
 * disclosure appears — and never from the code itself.
 */
export const FLAG_BASIS: Record<EmailFlagCode, FlagBasis> = {
  new_contact: "mailbox",
  new_company: "mailbox",
  free_mailbox_sender: "header",
  newsletter_or_marketing: "header",
  receipt_or_automated: "header",
  external_links: "mime",
  attachment_received: "mime",
  pdf_attachment: "mime",
  image_attachment: "mime",
  possible_scam: "model",
  possible_phishing: "model",
  suspicious_sender: "model",
  sender_domain_mismatch: "model",
  urgent_language: "model",
  payment_or_invoice_request: "model",
  sensitive_info_request: "model",
};

export const ALL_FLAG_CODES = Object.keys(FLAG_BASIS) as EmailFlagCode[];

export const isInferred = (c: EmailFlagCode) => FLAG_BASIS[c] === "model";

/**
 * Rows arrive from PostgREST untyped. The CHECK is the enforcement; the client
 * gets its own default-deny, because an unrecognised code has no dictionary key
 * and would otherwise render a styled, empty chip — which reads as a flag with
 * no name, in the one place a boss is being asked to be careful.
 */
export function isEmailFlagCode(v: unknown): v is EmailFlagCode {
  return typeof v === "string" && v in FLAG_BASIS;
}

export interface TodoFlag {
  todo_id: string;
  code: EmailFlagCode;
  detected_at: string;
  /**
   * The database's GENERATED value. Kept for SQL-side queries and as the
   * insert-time guard; the UI never reads it, deriving from FLAG_BASIS[code]
   * instead, so one expression drifting cannot move an inferred claim into the
   * unhedged group in front of a boss.
   */
  basis?: FlagBasis;
}

/**
 * Inferred first — they are the ones that change a decision — then observed;
 * within a group, the declaration order of FLAG_BASIS. Deterministic and
 * entirely ours: the sender cannot influence which badge the eye lands on
 * first, which is the only ordering worth having here.
 */
export function orderFlags(flags: TodoFlag[]): TodoFlag[] {
  const rank = (f: TodoFlag) => (isInferred(f.code) ? 0 : 1);
  return [...flags].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      ALL_FLAG_CODES.indexOf(a.code) - ALL_FLAG_CODES.indexOf(b.code),
  );
}

/**
 * Worst first, and the ONLY ordering the collapsed row consults. Explicit
 * rather than derived from FLAG_BASIS order, because what belongs on a
 * collapsed card is a separate judgement from what reads well in a list.
 */
const COLLAPSED_ORDER: EmailFlagCode[] = [
  "possible_scam",
  "possible_phishing",
  "sender_domain_mismatch",
  "sensitive_info_request",
  "suspicious_sender",
  "payment_or_invoice_request",
  "urgent_language",
];

export function worstInferred(flags: TodoFlag[]): EmailFlagCode | null {
  const present = new Set(flags.map((f) => f.code));
  return COLLAPSED_ORDER.find((c) => present.has(c)) ?? null;
}

/* --------------------------------------------------------------- evidence */

/** Closed. Nothing here is free text a sender chose. */
export type SensitiveKind = "password" | "bank_details" | "id_document" | "otp";

/**
 * Facts, not sentences. The card composes the sentence from a dictionary
 * template plus these slots, so the reason line is Dovis's sentence with the
 * sender's noun in it — never the sender's sentence.
 *
 * `cites` is the citation rule: an inferred flag may only display when it names
 * at least one observed flag present on the same message. "Possible phishing"
 * may appear because a link's label disagrees with its destination and this is a
 * first contact on a free mailbox. It may not appear because the prose felt off.
 * That is the cheapest available brake on false positives, and it is enforced in
 * the database rather than in a prompt.
 */
export type FlagEvidence =
  | { code: "possible_scam"; cites: EmailFlagCode[] }
  | { code: "possible_phishing"; cites: EmailFlagCode[] }
  | { code: "suspicious_sender"; cites: EmailFlagCode[] }
  | { code: "sender_domain_mismatch"; claimed: string; domain: string }
  | { code: "urgent_language"; terms: string[] }
  | { code: "payment_or_invoice_request"; amount_text: string | null; new_account: boolean }
  | { code: "sensitive_info_request"; asked_for: SensitiveKind[] };

export type FlagEvidenceMap = Partial<Record<EmailFlagCode, FlagEvidence>>;

/* ------------------------------------------------------------ attachments */

/** Derived by the box from mime_sniffed ALONE. A .exe named invoice.pdf is 'other'. */
export type AttachmentKind = "image" | "pdf" | "other";

/** 'none' is "not previewable"; 'failed' is "we tried and could not". Different sentences. */
export type AttachmentPreview = "ready" | "none" | "failed";

/**
 * Note what is absent: no URL, no Gmail id, no path. The browser addresses an
 * attachment by `id` and the server resolves the locator. Adding a url field
 * here would defeat the entire todo_attachment_sources split.
 */
export interface TodoAttachment {
  id: string;
  todo_id: string;
  position: number;
  /** SENDER-CHOSEN, untrusted. sanitizeDisplay() before it reaches the DOM. */
  filename: string;
  /** What the message part claimed. Never pick a renderer or a header from this. */
  mime_declared: string | null;
  /** What the box measured. The trusted one. */
  mime_sniffed: string | null;
  size_bytes: number | null;
  kind: AttachmentKind;
  preview: AttachmentPreview;
  created_at: string;
}

/**
 * Both routes require a session AND `profile.role === "owner"` — stricter than
 * the can_modify gate that governs this row's metadata. An attachment is the
 * third party's original document, not the owner's mail rewritten, and Aaron's
 * 2026-09-05 decision removes mailbox access from assistants entirely.
 *
 * These return a path, not a permission. The component asks `canOpen` first.
 */
export const attachmentHref = (a: TodoAttachment) => `/api/attachment/${a.id}`;
export const attachmentThumbHref = (a: TodoAttachment) =>
  a.preview === "ready" ? `/api/attachment/${a.id}?variant=thumb` : null;

/* ------------------------------------------------------------------ links */

export type LinkSafety = "safe" | "unverified" | "blocked";

export interface EmailLink {
  /** Attacker-controlled. Safe as text, gated as an href. */
  url: string;
  /** The sender-chosen anchor text. NEVER shown without the parsed host beside it. */
  label: string | null;
  /**
   * DEFAULT 'unverified', which is the point: a link the analyser wrote without
   * reaching a verdict is never clickable. A necessary condition, never a
   * sufficient one — linkTarget() re-parses before an href exists.
   */
  safety: LinkSafety;
}

const CLICKABLE_PROTOCOLS = new Set(["https:"]);

/**
 * The second gate, and the reason EmailLink carries no `href` field: a component
 * cannot render a link without calling this, because there is nothing else to
 * put in the attribute. Aaron's "clickable ONLY after safe-URL validation",
 * expressed as a type rather than as a rule someone has to remember.
 *
 * Returns null — meaning "render as inert text" — unless the stored verdict is
 * `safe`, the URL parses, the scheme is https, and the authority carries no
 * userinfo. The href is the parser's own output, so what was validated is what
 * is navigated to.
 *
 * `https:` only. React 19.2.8 rewrites `javascript:` hrefs in production
 * (react-dom-client.production.js, sanitizeURL) but does nothing to
 * `data:text/html`, `vbscript:`, `blob:` or `file:` — so the allowlist is
 * load-bearing for every scheme React does not touch. Plain `http:` is refused
 * separately: a boss clicking unencrypted HTTP out of a suspicious email is the
 * phishing path itself.
 */
export function linkTarget(link: EmailLink): { href: string; host: string } | null {
  if (link.safety !== "safe") return null;
  let u: URL;
  try {
    u = new URL(link.url);
  } catch {
    return null;
  }
  if (!CLICKABLE_PROTOCOLS.has(u.protocol)) return null;
  // https://accounts.google.com@evil.tld/reset lands on evil.tld. Everything
  // before the @ is a username, and this is the one case where showing a
  // hostname would actively help the phish.
  if (u.username || u.password) return null;
  return { href: u.toString(), host: u.hostname };
}

/**
 * For display beside a link that is NOT clickable — a blocked link still shows
 * where it goes, because that is the whole point of showing it at all.
 *
 * `URL.hostname` normalises IDN to punycode in both Node and the browser, so
 * `paypaĺ.com` displays as `xn--paypa-w0a.com`. That is ugly and it is exactly
 * the right ugly: never prettify it back to Unicode.
 */
export function linkHost(link: EmailLink): string | null {
  try {
    return new URL(link.url).hostname;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- analysis state */

export type AnalysisState = "ok" | "partial" | "failed";

export interface TodoEmailAnalysis {
  todo_id: string;
  state: AnalysisState;
  analysed_at: string;
  sources: Partial<Record<"headers" | "body" | "attachments" | "history", boolean>>;
  links: EmailLink[];
}
```

And the one edit to an existing interface:

```ts
export interface TodoPayload {
  todo_id: string;
  payload_proposed: DraftEmailPayload | ManualPayload;
  payload_current: DraftEmailPayload | ManualPayload;
  modify_note: string | null;
  reject_reason: string | null;
  /**
   * Per-flag evidence for inferred flags, keyed by EmailFlagCode. Body-derived,
   * so it lives here and inherits this row's gate. Required, not optional — the
   * column is `not null default '{}'`, so the route always returns at least an
   * empty object and the UI must handle the empty case rather than forget it
   * exists.
   */
  flag_evidence: FlagEvidenceMap;
}
```

`DraftEmailPayload` and `ManualPayload` are **untouched**, and `ActionType` stays
`"draft_email" | "manual"`. This feature adds no action type and needs none:
flags describe mail that arrived, and the thing the owner approves is still a
draft or a manual note.

Nothing is added to `Todo`. That is load-bearing, not an oversight — see §7.6.

### Why evidence is not a column on `payload_current`

The obvious placement is inside the payload the card already loads. It is wrong,
and the reason is in the schema's own comment: `payload_proposed` is *"NEVER
overwritten"*, which means `payload_current` **is**. `/api/act` moves a modified
row to `modifying`, and the executor on the box then rewrites `payload_current`.

Evidence hung off that object survives a Modify round-trip only if an off-box
agent remembers to copy an unrelated sub-object forward. The first time it
forgets, the card silently loses its warnings — with the collapsed chip still lit
from `todo_flags` and nothing behind it. That is fail-open in the one place this
feature exists to fail closed. A dedicated column on the same row is immutable
by construction and costs one `add column if not exists`.

### Why a CHECK, not a Postgres enum

Consistency with `todos.action_type` and `dashboard_widgets.widget_type` is the
weaker half of the argument. The stronger half is that `alter type … add value`
cannot run inside a transaction block and enum values cannot be removed, so an
enum would make `schema.sql` non-re-runnable — which is the property that file
promises in its own header.

### Which columns get a CHECK, and which must not

This is easy to get backwards, and getting it backwards creates a vulnerability.

Constrained, because the value is chosen by **our** analyser from a vocabulary we
own: `todo_flags.code`, `todo_attachments.kind`, `todo_attachments.preview`,
`todo_attachment_sources.provider`, `todo_email_analysis.state`, and the *shape*
of `flag_evidence` and `links`. A bad value there is a bug in our code and
failing the insert loudly is right.

Unconstrained on purpose, because the value is chosen by **the sender**:
`todo_attachments.filename`, the `url` and `label` inside `links`, and the string
slots inside `flag_evidence`. The tempting constraints — a 255-character cap on
filename, a URL-shape regex — all convert *"the sender picked a hostile string"*
into *"the row does not exist"*. A sender who wants their attachment to go
unrecorded would only need a 300-character filename. Store verbatim, defend at
render.

---

## Untrusted content, made mechanical

Aaron's rule is that email content is data and never instruction. That rule is
worth nothing as a sentence, so here is every place it becomes a mechanism.

**There are three consumers of attacker bytes, and they need different
containment.** The model reading the mail is contained by the toolset allowlist,
exactly as `WEB-CHAT-DESIGN.md` argues for `gmail_reply`. The browser is
contained by escaped JSX, which `queue.tsx` already does correctly. The third is
**a later model that re-reads the queue** — `/api/recap` is designed to assemble
a queue delta and forward it to Hermes as context — and it is currently
uncontained. A free-text `reason` field would be attacker-influenced text
arriving as trusted *analysis* in the context of a model holding the owner's
Gmail toolset. That is second-order prompt injection, and it is the reason
evidence is a typed union rather than a sentence.

The honest statement, matching the design doc's own line: for a later model, the
toolset on the route it runs on is the containment. Everything below is
mitigation.

**1. The label is never a server string.** A flag row carries a code. The words
come from `FLAG_LABELS` in `i18n.ts`, in two languages, written by a person. If
the UI ever rendered a label from the row, an email able to influence the
analyser could write its own chip text — *"Verified safe by Dovis"* in the boss's
own font, sitting where a warning belongs. The closed union plus dictionary
lookup **is** the containment; nothing else in the render path provides it.

**2. The evidence is slots, not prose.** `{claimed: "Acme", domain: "gmail.com"}`
composed into *"The message signs off as Acme, but was sent from gmail.com."*
The one field that carries attacker text at all is `urgent_language.terms` — at
most three spans, each capped at 40 characters server-side, rendered inside
quotation marks explicitly attributed to the message rather than to Dovis.

**3. The render path stays exactly as it is.** `package.json` contains no
markdown renderer, no sanitizer and no linkifier. `queue.tsx` already prints the
most attacker-adjacent strings in the product — `to`, `subject` and the full
`body` of a drafted email — as escaped JSX under `whitespace-pre-wrap`. Flags,
evidence, filenames and URLs render the same way. No HTML, no remote images, no
auto-linking. `WEB-CHAT-DESIGN.md` asserts this property of the repo; making
validated links clickable is a deliberate amendment to it, and that document
should be edited in the same commit rather than left asserting something no
longer strictly true.

**4. `sanitizeDisplay()`, applied at render, not only at write.** React escapes
`<`, `>`, `&` and quotes. It does nothing about U+202E RIGHT-TO-LEFT OVERRIDE.
A filename of `invoice‮gpj.exe` renders on the card as `invoiceexe.jpg`, and
the boss downloads and runs an executable he was shown as an image. This survives
every escaping mechanism the framework has, because the bytes are innocent and
the glyph order is the payload. It has to be at render because rows already in
the database predate the fix, and `todos.title` is model-written from mail today.

```ts
// src/lib/untrusted.ts

/**
 * Written as explicit escapes on purpose. A character class of literal
 * invisibles cannot be reviewed in a diff, does not survive a copy-paste, and
 * this is the one regex in the product that has to be provably right.
 *
 *   202A-202E  LRE RLE PDF LRO RLO   the classic report-<RLO>fdp.exe attack
 *   2066-2069  LRI RLI FSI PDI       the newer isolate family
 *   200E 200F  LRM RLM               directional marks
 *   061C       ALM                   Arabic letter mark
 *   200B-200D  ZWSP ZWNJ ZWJ         invisible splitters
 *   FEFF       BOM / ZWNBSP
 *   0000-001F, 007F                  C0 controls and DEL
 */
const UNSAFE_DISPLAY_CHARS =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\uFEFF\u0000-\u001F\u007F]/gu;

/**
 * `max` is a layout defence as well as a legibility one: a 4,000-character
 * filename at 320px pushes Confirm, Modify and Reject off the screen, which is
 * a denial of service delivered by attachment.
 */
export function sanitizeDisplay(raw: string, max = 100): string {
  const clean = raw.replace(UNSAFE_DISPLAY_CHARS, "").trim();
  if (clean.length <= max) return clean;
  // Middle ellipsis, so the true extension survives the clamp — the whole point
  // of showing a filename to someone deciding whether to open it.
  const head = clean.slice(0, max - 12);
  const tail = clean.slice(-9);
  return `${head}…${tail}`;
}
```

Every container rendering a sanitised string also carries `dir="ltr"`, so a mark
that survives cannot reorder anything outside its own element.

**5. Path traversal is a non-issue and must stay one by construction.** The
filename is display text and a `Content-Disposition` parameter. It is never used
to build a path, look up a row, or key a cache. That is an explicit comment in
the route, so nobody later "improves" it into a lookup key.

**6. The type badge never comes from the filename.** It comes from
`mime_sniffed`, which the box measured from the leading bytes. A `.pdf` name over
`application/x-msdownload` bytes reads as a generic file, and the declared type
is shown as text beside the filename so the disagreement is visible.

**7. Nothing fetches a URL an email supplied.** Not the browser, not the server.
A remote `<img src>` in a rendered message is a read receipt firing the moment
the boss expands the card, plus an IP and user-agent leak. A server-side fetch is
that plus SSRF against the box's own network — `http://169.254.169.254/`,
`http://localhost:…` — from a process sitting next to the OAuth credentials
directory. There is no link preview, no unfurl, no prefetch, no preconnect. The
only image on this surface is a same-origin re-encode served by our own
authenticated route, which is why it is not the auto-open Aaron forbade.

**8. The dictionary is a second compile-time gate.** `i18n.ts` already carries
`export const languages: Record<Lang, Dict> = dict` to fail the build when one
language is short a key. That assertion proves only that zh-TW carries every
`en` key; it says nothing about `EmailFlagCode`. So `FLAG_LABELS` is annotated
separately and explicitly against the union — see the strings section — and the
render still guards, because a missing key otherwise paints a styled empty chip.

---

## Factual and inferred, and how the card says which

The wording rule is **not** "hedge everything". Hedging a fact is its own
dishonesty: *"possibly a PDF attachment"* teaches the reader to distrust the
flags that genuinely need distrust, and habituation is the real failure mode of
this whole feature. Sixteen chips that all shout are sixteen chips nobody reads
by the third card.

So the rule is that **wording tier follows evidence tier, not severity tier**,
and `basis` is the mechanism.

Observed — a parser established it from headers, MIME structure or the mailbox's
history — states it flat. *"New contact." "PDF attachment."* Neutral chip, no
icon, no colour.

Inferred — a model read text a stranger wrote — hedges, every time.
*"Possible…" "…looks…" "May…" "Mentions…"* Coloured chip, an icon, and a
disclosure carrying the citation.

That is why four of Aaron's sixteen labels are reworded, and each rewording is
a claim the box cannot actually support.

*"Suspicious sender"* is a verdict on a person that cannot cite evidence,
because it **is** the thing evidence would support. It becomes *"Sender looks
unusual"*.

*"Sender domain does not match claimed company"* asserts a checked fact, and the
"claimed company" comes out of the email body — so its only evidence is the
attacker's own text, an attacker can evade it by omitting the claim, and a
legitimate reseller emailing from their own domain about a client trips it
constantly. It becomes *"Domain may not match the company named"*.

*"Urgent language detected"* — "detected" claims a measurement. It becomes
*"Urgent-sounding language"*.

*"Payment or invoice request"* asserts intent about what is usually a keyword
match, and a legitimate invoice must not be accused. It becomes *"Mentions a
payment or invoice"*.

*"Sensitive-information request"* becomes *"May be asking for sensitive
details"*, for the same reason.

Two visual mechanisms, not two shades of one, so the tiers separate in
greyscale:

```ts
const TIER_CHIP: Record<"inferred" | "observed", string> = {
  // Coloured text. --destructive is oklch(0.52 0.19 27) on paper and
  // oklch(0.62 0.18 27) on the ink-teal ground: the token is redefined in
  // .dark, so this needs no dark: variant and cannot go invisible.
  inferred: "border-destructive/40 bg-destructive/8 text-destructive",
  // No colour at all. A PDF is not a warning.
  observed: "border-border bg-card text-muted-foreground",
};
```

`--destructive` rather than `--status-failed`, even though the two carry the same
oklch value in `:root`. `globals.css` says of the status set *"Bound to queue
meaning, never decoration"*, and a caution chip is not a queue lifecycle state.
Reusing `text-status-failed border-status-failed/40 bg-status-failed/8` would
make the chip byte-identical to `STATUS_STYLES.failed` and to the paused badge in
`team-table.tsx` — three different meanings in one treatment. `--destructive` is
the palette's stop-and-read red, and its danger-zone association is right here:
confirming a phishing draft is exactly a consequence you cannot take back.

Amber is deliberately **not** used. `globals.css` binds `--secondary` /
`--status-executing` to *"a decision is waiting on you"* and to work in progress,
and `queue.tsx` already renders `· priority` in `text-status-failed` on the
high-priority email items this feature targets. Adding a third meaning in a
fourth place ends the queue's colour vocabulary.

Icons come from **lucide**, per tier, never per flag. Every icon in this repo is
lucide — `queue.tsx` imports `ChevronDown`, `Mail`, `Hand`, `AlertTriangle`; the
only non-Latin glyphs anywhere in the UI are the two characters 繁中 in the
language chip. Emoji would be wrong on three counts, and the third is the one
that matters: emoji do not inherit `currentColor`, so a siren would be the one
element on the card that looks identical in light and dark, and it would assert
alarm visually while the text says *"possible"*. The icon and the words must
hedge together, or the hedge is theatre. `AlertTriangle` for inferred, nothing
for observed — the absence is itself the signal, and it is the tier you are
allowed to skim.

**No motion on this surface.** `.animate-working` is bound to `executing` and
means *a run is in flight on the box*; reusing it would break the
one-motion-one-meaning rule, and a pulsing red chip asserts urgency the wording
is trying to withdraw.

**Never colour alone.** Each tier is separated three ways: a group heading in
words, an icon or its pointed absence, and the chip treatment. Read the panel in
greyscale and the tiers still separate.

---

## The attachment route, in full

`src/app/api/attachment/[id]/route.ts`. This is the only route by which a byte
of the principal's received mail reaches a browser, so it is written out
completely rather than described.

```ts
import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * Attachment bytes and derived previews.
 *
 * OWNER ONLY — deliberately stricter than /api/payload/[id]'s can_modify gate.
 * A draft is the owner's mail rewritten in the owner's voice; an attachment is
 * the third party's original document, and Aaron's 2026-09-05 decision removed
 * mailbox access from assistants entirely. Serving one here would reinstate that
 * capability through a different door and leave the permission model saying two
 * different things.
 *
 * `id` is a UUID from OUR table. The URL carries no Gmail identifier, no token,
 * no path, no MIME type, no filename and no signature. Everything is resolved
 * server-side from that one opaque key. A Gmail attachment id is not redeemable
 * without the owner's OAuth token, so it is not a bearer credential — but it is
 * internal structure of the principal's mailbox, and URLs leak through Referer,
 * history, screenshots and pastes into a chat.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Content-Type allowlist, keyed off SNIFFED MAGIC BYTES.
 *
 * This is the barrier that matters. An attacker mails `notes.html`, or `x.svg`,
 * or HTML named `.pdf`. If the route echoed the email-declared MIME and the boss
 * opened it, that HTML would execute on the dashboard's own origin — same origin
 * as the Supabase session cookie — and could then read every draft through
 * /api/payload, confirm items into the owner's Gmail through /api/act, and mint
 * an account through /api/team/create. One inbound email to total compromise.
 * `nosniff` does not stop it, because `nosniff` honours a declared `text/html`.
 *
 * `image/svg+xml` is NOT here, on purpose: SVG renders as an image but executes
 * as a document when navigated to.
 *
 * `text/plain` is NOT here either, and that is a decision rather than an
 * oversight. Text has no magic number, so admitting it means falling back to the
 * extension or the declared type — the exact hole this allowlist closes. A .txt
 * attachment is served as application/octet-stream, download-only.
 */
const SIGNATURES: { mime: string; inline: boolean; test: (b: Uint8Array) => boolean }[] = [
  { mime: "application/pdf", inline: true,
    test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { mime: "image/png", inline: true,
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", inline: true,
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", inline: true,
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { mime: "image/webp", inline: true,
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

function sniff(bytes: Uint8Array) {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ?? { mime: "application/octet-stream", inline: false };
}

/**
 * RFC 6266. The filename is attacker-controlled and must never be interpolated
 * raw: a double quote or a CRLF inside it breaks the header, and a CRLF is
 * header injection. An ASCII-only fallback built from a strict whitelist, plus
 * the percent-encoded UTF-8 form for browsers that understand it.
 *
 * NOTE for whoever reads this next: this filename is display metadata and a
 * header parameter. It is never used to build a path, key a lookup, or name a
 * cache entry, which is why path traversal is not a concern here. Do not turn it
 * into any of those.
 */
function contentDisposition(filename: string, disposition: "inline" | "attachment") {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "attachment";
  const utf8 = encodeURIComponent(filename).slice(0, 200);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json(
      { error: "Only the owner can open attachments." },
      { status: 403 },
    );

  const { id } = await params;
  // Validate before it touches a query, so a malformed id is a 404 rather than
  // a Postgres error message echoed to a browser.
  if (!UUID.test(id)) return notFound();

  const url = new URL(req.url);
  const wantThumb = url.searchParams.get("variant") === "thumb";
  // The disposition is validated against a literal set AND may only NARROW: a
  // caller may ask for `attachment` on a PDF, never for `inline` on an
  // octet-stream. An attacker-influenced disposition is header injection; a
  // caller-widened one is the content-type bypass wearing a different hat.
  const asked = url.searchParams.get("disposition");
  const forceDownload = asked === "attachment";
  if (asked !== null && asked !== "inline" && asked !== "attachment") return notFound();

  const admin = createAdmin();

  /*
    The join through `todos` is currently a tautology — one box, one boss — and
    is written anyway. The version that filters on id alone is the one that
    becomes a vulnerability the day two deployments share a database.
  */
  const { data: row, error } = await admin
    .from("todo_attachments")
    .select("id, filename, kind, preview, todo_id, todos!inner(id), todo_attachment_sources(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("attachment lookup failed", error);
    return notFound();
  }
  if (!row) return notFound();

  const src = row.todo_attachment_sources;
  if (!src) return notFound();

  if (wantThumb && (row.preview !== "ready" || !src.preview_key)) return notFound();

  /*
    Bytes come from exactly one of two places, and neither is a URL from an
    email:
      - the thumbnail, a derived re-encode the box wrote at ingest, addressed by
        a content hash the schema constrains to ^[0-9a-f]{64}$;
      - the original, fetched from Gmail with the box's own credential, streamed
        through and never written to disk.
    There is no fetch(row.url) and no path.join(root, row.filename) on either
    branch, and there must never be.
  */
  const fetched = wantThumb
    ? await readPreview(src.preview_key!)
    : await fetchFromGmail(src.message_id, src.remote_id, MAX_BYTES);

  // "No such row", "the message was deleted", and "the read failed" all return
  // the same 404. Differing responses would turn this route into an oracle for
  // which attachments exist.
  if (!fetched) return notFound();

  const head = fetched.bytes.subarray(0, 16);
  const { mime, inline } = sniff(head);
  const disposition = inline && !forceDownload ? "inline" : "attachment";

  return new NextResponse(fetched.bytes, {
    headers: {
      "content-type": mime,
      "content-length": String(fetched.bytes.byteLength),
      "content-disposition": contentDisposition(row.filename, disposition),
      // Honours a declared type, so it is necessary and not sufficient — the
      // magic-byte allowlist above is what actually does the work.
      "x-content-type-options": "nosniff",
      /*
        A per-response policy that survives a mistake in the allowlist. It puts
        a top-level navigation to this route in an OPAQUE ORIGIN, so even a PDF
        carrying JavaScript cannot reach the dashboard's cookies or call its
        APIs. Note it is ignored for subresource loads (an <img>) — for those,
        nosniff plus the allowlist is the protection.
      */
      "content-security-policy":
        "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-store, private",
    },
  });
}

/*
  A fixed message, and the detail in the server log. /api/payload/[id] currently
  returns `{ error: error.message }` with a 500 straight from PostgREST, which
  echoes column names, constraint names and Postgres error text to the browser —
  and so do /api/act, /api/queue/clear-completed and /api/queue/delete-all. That
  is a sibling set worth fixing in the same pass; this route must not inherit it.
*/
function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

Three things about this route that are easy to lose.

**PDF preview opens a new tab; it is never framed.** `<iframe src="/api/attachment/…">`
hands the file to the browser's PDF viewer — a large parser with a long CVE
history — inside a document context that is same-origin with the dashboard,
next to the session cookie. The Preview button is a user gesture calling
`window.open()`, and the per-response `sandbox` puts that document in an opaque
origin. Same UI state Aaron asked for, a fraction of the risk, no new dependency.
If a genuine in-page preview is ever wanted, the safe version is to render page
one to a PNG server-side at ingest and serve it through the thumbnail path —
never to ship the raw PDF into a frame.

**The thumbnail is not the attachment.** At ingest the box decodes the image in a
bounded process, rejects anything past a pixel-count ceiling, re-encodes to a
≤512px WebP stripped of metadata, and stores that. `?variant=thumb` serves those
derived, known-safe bytes. That closes four attacks at once: the tracking pixel
(the src is same-origin), the SSRF (nothing resolves a remote URL), the decoder
bomb (a 40,000 × 40,000 PNG never reaches a browser decoder), and the EXIF leak
(GPS and device identity are stripped). If generation failed, the UI shows the
unavailable state and **never** silently falls back to the original bytes — that
fallback is precisely how the decoder bomb would reach the browser.

**Rate limiting is absent from every route in this app today.** This one streams
binary and `/api/payload` hits the database on every card expansion, so a stolen
owner session or a compromised browser extension can enumerate the attachment
store at line speed with no trace. It requires an already-authenticated owner
session, so it ranks below everything above — but it is the difference between
one file leaking and the archive leaking. Cap concurrent streams and bytes per
session per minute.

---

## Links

Aaron's spec says *"show title or hostname"*. It must not be *or*. The title is
whatever the sender typed — `<a href="https://evil.tld">Your DocuSign document</a>`
— so the title **is** the attack. The hostname is the only string on screen that
determines where a tap lands.

So the hostname is the headline, in `font-mono`, always shown, from
`new URL().hostname` and never from a substring of the raw href. The sender's
link text is a muted subtitle beneath it and never appears alone. Punycode is
displayed as punycode; if `URL.hostname` differs from the Unicode form, that
difference is what a homograph domain looks like from here, and prettifying it
back defeats the entire purpose of showing a hostname.

An unvalidated link renders as a `<span>`, not as an `<a>` with a blocked
`onClick` or `aria-disabled`. A disabled anchor still carries an href, which is
still middle-clickable, still copyable from the context menu, and still shown in
the status bar — three routes to a place the dashboard has just told the boss it
would not send him. `linkTarget()` returns null, so there is nothing to put in
the attribute, and no anchor exists in the DOM.

Where an anchor does exist: a plain `<a>`, never Next's `<Link>` so nothing
prefetches, with `target="_blank"` and
`rel="noopener noreferrer nofollow ugc external"`. `noopener` closes reverse
tabnabbing, where the opened page rewrites the dashboard tab into a fake login.
`noreferrer` stops the dashboard's URL — which on a Cloudflare Tunnel is the
client's own domain — leaking to the attacker's server. Modern browsers imply
`noopener`; write it anyway, because this has to survive an embedded webview.

The whole row is a `<details>`, which is both the *"expandable to inspect"*
requirement and the reason it stays one line tall at 375px: hostname collapsed,
full URL on demand, rendered `select-all` and `break-all` so the boss can tap
once and paste it into a checker rather than dragging a selection across a
wrapped string.

One honest caveat about the copy. If the analyser's "safe" verdict is nothing
more than a scheme test and a userinfo test, then *"did not pass the check"*
promises more than the check delivers. Anything richer — a reputation lookup, a
redirect trace — is an outbound fetch driven by an attacker-supplied URL, which
is the one capability `WEB-CHAT-DESIGN.md` names as wrong for an
injection-adjacent run. Decide which, and match the wording to it.

---

## The strings

`FLAG_LABELS` is separate from `dict` and explicitly annotated, because the
existing `languages: Record<Lang, Dict>` assertion cannot do this job: `Dict` is
`typeof dict.en`, so a key missing from `en` just makes `Dict` smaller and
nothing errors. Annotating against `EmailFlagCode` makes a seventeenth code a
build failure in both languages simultaneously, by name.

```ts
import type { EmailFlagCode } from "@/lib/types";

/*
  Cautious wording lives IN THE LABEL, not in a tooltip: "Possible scam", never
  "Scam". zh-TW carries the same hedge — 可能是詐騙, not 詐騙 — because a warning
  that hardens when you switch language is a different warning.

  snake_case keys, breaking the camelCase house style, deliberately: it makes
  `FLAG_LABELS[lang][code]` a direct index with no mapping table between the
  union and the dictionary. A mapping table would be a third thing to keep in
  sync and the one most likely to rot; a direct index cannot drift.
*/
export const FLAG_LABELS: Record<Lang, Record<EmailFlagCode, string>> = {
  en: {
    new_contact: "New contact",
    new_company: "New company domain",
    free_mailbox_sender: "Free mailbox address",
    newsletter_or_marketing: "Newsletter or marketing",
    receipt_or_automated: "Receipt or automated notification",
    external_links: "External links",
    attachment_received: "Attachment received",
    pdf_attachment: "PDF attachment",
    image_attachment: "Image attachment",
    possible_scam: "Possible scam",
    possible_phishing: "Possible phishing",
    suspicious_sender: "Sender looks unusual",
    sender_domain_mismatch: "Domain may not match the company named",
    urgent_language: "Urgent-sounding language",
    payment_or_invoice_request: "Mentions a payment or invoice",
    sensitive_info_request: "May be asking for sensitive details",
  },
  "zh-TW": {
    new_contact: "初次往來的聯絡人",
    new_company: "初次往來的公司網域",
    free_mailbox_sender: "寄件者使用免費信箱",
    newsletter_or_marketing: "電子報或行銷郵件",
    receipt_or_automated: "收據或系統自動通知",
    external_links: "含有外部連結",
    attachment_received: "含有附件",
    pdf_attachment: "PDF 附件",
    image_attachment: "圖片附件",
    possible_scam: "可能是詐騙",
    possible_phishing: "可能是釣魚郵件",
    suspicious_sender: "寄件者看起來不太尋常",
    sender_domain_mismatch: "網域可能與信中所稱的公司不符",
    urgent_language: "用詞帶有急迫感",
    payment_or_invoice_request: "提到付款或請款",
    sensitive_info_request: "可能在索取敏感資訊",
  },
};
```

Evidence templates, one per inferred flag, with named slots filled by
`.replace("{claimed}", …)` — the same idiom `waitingHeadline` already uses for
`{n}`. These are ordinary `dict` keys, so the existing assertion covers them.

```ts
    evidence: {
      possible_scam: "This message trips {n} of the checks Dovis runs: {cites}.",
      possible_phishing: "This message trips {n} of the checks Dovis runs: {cites}.",
      suspicious_sender: "Based on {cites}.",
      sender_domain_mismatch:
        "The message signs off as {claimed}, but was sent from {domain}.",
      urgent_language: "The message uses: {terms}.",
      payment_or_invoice_request: "Mentions {amount}, to an account not used before.",
      payment_or_invoice_request_known: "Mentions {amount}.",
      sensitive_info_request: "Appears to ask for {kinds}.",
    },
    sensitive: {
      password: "a password",
      bank_details: "bank details",
      id_document: "an identity document",
      otp: "a one-time code",
    },
```

```ts
    evidence: {
      possible_scam: "這封信觸發了 Dovis 檢查項目中的 {n} 項：{cites}。",
      possible_phishing: "這封信觸發了 Dovis 檢查項目中的 {n} 項：{cites}。",
      suspicious_sender: "依據：{cites}。",
      sender_domain_mismatch: "信中署名為 {claimed}，但寄件網域是 {domain}。",
      urgent_language: "信中使用了：{terms}。",
      payment_or_invoice_request: "提到 {amount}，且收款帳戶是過去沒有用過的。",
      payment_or_invoice_request_known: "提到 {amount}。",
      sensitive_info_request: "似乎在索取{kinds}。",
    },
    sensitive: {
      password: "密碼",
      bank_details: "銀行帳戶資訊",
      id_document: "身分證件",
      otp: "一次性驗證碼",
    },
```

Everything else the surface says, in both languages. Nested under `email` to
match the existing `t.status.*` and `t.action.*` shape.

```ts
    email: {
      heading: "What Dovis noticed",
      disclaimer: "Observations from the message, not conclusions.",
      groupInferred: "Worth checking before you act",
      groupObserved: "What the message contains",
      why: "Why",
      summaryOne: "One thing on this message is worth a second look.",
      summary: "{n} things on this message are worth a second look.",
      notChecked: "Not checked.",
      partlyChecked: "Only partly checked — some sources could not be read.",
      checkFailed: "The check did not finish.",
      nothingStoodOut: "Nothing stood out.",

      attachments: "Attachments",
      attachmentOpen: "Open",
      attachmentPreview: "Preview",
      attachmentDownload: "Download",
      attachmentNoPreview: "No preview",
      attachmentUnavailable: "Dovis could not fetch this attachment.",
      attachmentOwnerOnly: "Only the owner can open attachments.",
      attachmentUnnamed: "Unnamed file",
      messageId: "Message id",

      links: "Links",
      linkOpen: "Open in a new tab",
      linkExternal: "External link",
      linkNotClickable: "Shown, not opened — this address did not pass the check.",
      linkNeverAuto: "Dovis never opens a link because a message asked it to.",
    },
```

```ts
    email: {
      heading: "Dovis 注意到的事",
      disclaimer: "這些是從郵件裡看到的線索，不是結論。",
      groupInferred: "行動前值得確認",
      groupObserved: "郵件本身的內容",
      why: "原因",
      summaryOne: "這封郵件有一項值得再看一眼。",
      summary: "這封郵件有 {n} 項值得再看一眼。",
      notChecked: "尚未檢查。",
      partlyChecked: "只檢查了一部分，有些來源無法讀取。",
      checkFailed: "這次檢查沒有完成。",
      nothingStoodOut: "沒有特別發現。",

      attachments: "附件",
      attachmentOpen: "開啟",
      attachmentPreview: "預覽",
      attachmentDownload: "下載",
      attachmentNoPreview: "無法預覽",
      attachmentUnavailable: "Dovis 無法取得這個附件。",
      attachmentOwnerOnly: "只有擁有者可以開啟附件。",
      attachmentUnnamed: "未命名檔案",
      messageId: "郵件識別碼",

      links: "連結",
      linkOpen: "在新分頁開啟",
      linkExternal: "外部連結",
      linkNotClickable: "這個網址未通過檢查，只顯示、不開啟。",
      linkNeverAuto: "Dovis 不會因為郵件要求就自動開啟連結。",
    },
```

Taiwan vocabulary throughout, per `SOUL.md` and the existing dictionary: 網域 not
域名, 資訊 not 信息, 連結 not 链接, 分頁 not 标签页, 檔案 not 文件, 電子報, 請款,
釣魚郵件. Register matches the shipped strings — compare 等你決定 and 郵件草稿;
these are the same length and the same flatness.

Two keys are **not** needed. A read-only assistant sees no analysis section at
all, so there is no "reason withheld" string — the existing `draftsRestricted`
already covers that whole branch. And `+{n}` on the collapsed chip is a numeral,
not copy; hardcode it rather than adding an identical key to both dictionaries.

A shared `formatBytes()` belongs in `src/lib/utils.ts` rather than in the
component, because 1024-versus-1000 is not a decision to make twice.

---

## The collapsed card

Something must survive collapse, and the argument is in the code rather than in
taste. `queue.tsx` renders the action buttons on `!decided && perms.canModify`,
with no dependency on `open`. A boss can therefore approve a draft from the
collapsed row having read only `todo.title` — and the title is itself derived
from the sender's email. A queue that shows nothing until you expand is a one-tap
path from a fraudulent message to a draft in the owner's own Gmail under the
owner's name.

But exactly **one** chip. A row of five is read as chrome by the third card, and
banner blindness would cost more than it buys. So: one chip, promoted only from
the inferred tier by `worstInferred()`, never from the observed tier. *"PDF
attachment"* does not change how you triage; *"Possible phishing"* does.

It carries the flag's own label, not a generic word. *"Possible phishing"* costs
the same pixels as *"Risk"*, says more, and hedges itself grammatically; *"Risk"*
is a bare noun, which is both vaguer **and** a flatter assertion. The cautious
wording constraint expressed as information architecture rather than as a copy
tweak.

It sits second in the existing meta row, immediately after `<StatusPill>` and
before the action label, for two reasons: `StatusPill` is the anchor the eye
already lands on, and putting the chip at position two leaves action, source and
time as neutral separators between it and the `· priority` marker rather than
stacking two reds.

Its shape diverges from `StatusPill` deliberately. `StatusPill` is
`rounded-full`, uppercase, no icon. The chip is `rounded-md`, **sentence case**,
with `AlertTriangle`. Sentence case is not an oversight: `POSSIBLE PHISHING`
shouts, and shouting is an assertion of certainty that the word *possible* is
trying to withdraw.

It is a `<button>`, not a `<span>` — the boss's next question is *why*, and the
answer is one tap away — and it toggles the same panel the title does.

```tsx
const detailsId = `todo-details-${todo.id}`;
const flags = flagsByTodo[todo.id] ?? [];          // [] means unknown, see below
const inferred = flags.filter((f) => isInferred(f.code));
const worst = worstInferred(flags);

<StatusPill status={todo.status} />
{worst ? (
  <button
    type="button"
    onClick={toggle}
    aria-expanded={open}
    // Only when the panel is actually mounted. The panel is conditionally
    // rendered, and aria-controls pointing at a missing id is worse than absent.
    aria-controls={open ? detailsId : undefined}
    aria-label={`${FLAG_LABELS[lang][worst]}. ${
      inferred.length === 1
        ? t.email.summaryOne
        : t.email.summary.replace("{n}", String(inferred.length))
    }`}
    className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5",
      "text-[10px] font-medium leading-tight transition-colors",
      "border-destructive/40 bg-destructive/8 text-destructive hover:bg-destructive/15",
    )}
  >
    <AlertTriangle className="size-3 shrink-0" aria-hidden />
    {FLAG_LABELS[lang][worst]}
    {inferred.length > 1 ? (
      <span className="opacity-70">+{inferred.length - 1}</span>
    ) : null}
  </button>
) : null}
<span>{t.action[todo.action_type]}</span>
```

The visible text is two or three words and the accessible name is a full
sentence — the pattern `RefreshButton` already uses, where `aria-label` carries
*"Reconnecting — this may be out of date"* while the visible text stays
*"Refresh"*.

**One thing deliberately not built: a gate that blocks Confirm until the card has
been expanded.** The case for it is real — noticing is not reading, and on a
phone Confirm sits about 60px below the chip within one thumb's reach; this
codebase's whole argument is that structural incapability beats a warning that
was read. The case against is that it is friction on a queue whose promise is
that the boss clears it fast, and a false-positive `possible_scam` on a genuine
invoice makes him open a card he had already understood from the title. The
recommendation is to ship the chip alone and add the gate only if a Confirm
actually lands on a flagged row — which is one query against `confirmed_at` and
`todo_flags`, so the decision can be made from evidence rather than from either
argument. What must **not** happen under any circumstance is auto-expanding a
flagged card: that is a UI action taken because of what an email contained, which
is the exact shape of the rule this feature exists to hold.

---

## The expanded card

Order inside the panel: **flags, then the payload, then attachments, then
links.** That is the reading order the decision needs — what is questionable
about this message, and only then what Dovis wants to send about it. It has a
second benefit that falls out of the architecture: flags come from client state
already in hand, so they paint instantly on expand while the payload skeleton is
still resolving. The risk information never waits on a round trip.

**They render as siblings of `<PayloadView />`, not inside it.** This is the
placement mistake most likely to be made, and it would be invisible in review.
`PayloadView` returns early for `manual`:

```tsx
if (actionType === "manual") {
  const c = payload.payload_current as ManualPayload;
  return <p …>{c.detail}</p>;
}
```

Anything nested inside is therefore invisible on every `manual` item — including
`demo-data.ts` t4, *"Sign the renewed insurance policy — it needs your wet
signature"*, which is `manual`, `source: "email"`, and close to the canonical
case for this feature: a signature request with a PDF attached. Aaron's *"stay
compatible with the existing `draft_email` and `manual` action types"* is exactly
the requirement that would be dropped.

**The existing denied-versus-failed branch must be preserved verbatim.**
`queue.tsx` carries a comment explaining why it exists — *"Could not load told a
read-only assistant the app was broken, when in fact it was working exactly as
the owner configured it"* — and a rewrite of that block is the easiest way to
reintroduce the bug it was written to prevent.

Inferred flags render as **rows**, each a `<details>` whose summary is the label
and whose body is the composed evidence sentence. Observed flags render as a
wrapped **chip cloud**, each carrying its short fact inline as a muted suffix —
*"PDF attachment · quarterly-review.pdf, 240 KB"*. Uniform padding everywhere
would be the template look; this is the hierarchy doing work, and it is why an
observed flag needs no disclosure while still satisfying Aaron's *"show a short
reason"*.

**Observed flags never get a disclosure, and that is a contract with the box.**
An empty `<details>` that opens onto *"no reason recorded"* teaches the reader
that opening one is a waste, after which they stop opening the ones that matter.
If the analyser attaches evidence to an observed flag, the UI ignores it.

`<details>` rather than a tooltip or a popover, because `queue.tsx` already uses
`<details>`/`<summary>` for *"Original proposal"* — established idiom, zero JS,
zero state, keyboard operation and `aria-expanded` for free. A tooltip is
unreachable on touch and this is a mobile triage surface. A popover would overlay
the Confirm button, which is the mistake the provider's banner comment says the
team already refused to make once.

At 375px the content column is roughly 279px before the panel's own padding. The
summary is a full-width flex row: icon and label take the flexible middle and
wrap to at most two lines — the longest EN label, *"Domain may not match the
company named"*, is 38 characters and wraps to two at `text-xs` — while *"Why"*
and the chevron are `shrink-0` and pinned right so they never wrap under. The
evidence expands **below**, in flow, indented with `ml-2 border-l-2 pl-2.5`, the
same left-rule `PayloadView` already uses for the draft body. Nothing overlays,
nothing needs tap-outside-to-close, and the button row is simply pushed down.
Two taps maximum: expand card, expand flag.

Attachment rows never disappear. An attachment the box could not fetch is
information — Dovis saw one and could not get it — and hiding the failure would
silently rewrite what the message contained. The six states Aaron listed map
onto one row shape: the image thumbnail (a 40px fixed tile so rows do not jitter
as thumbnails resolve), the PDF preview button, the generic file tile, open/view,
download, and unavailable — the row at `opacity-60` with a `FileX` in
`text-destructive`, both buttons removed, and `attachmentUnavailable` beneath the
metadata. A seventh state exists for a `can_modify` assistant: both buttons
absent, `attachmentOwnerOnly` in their place.

One build note that will otherwise cost an afternoon. `src/components/ui/button.tsx`
wraps `@base-ui/react`, **not Radix**, and Base UI has no `asChild` — its
replacement is a `render` prop, and `nativeButton={false}` is required when the
rendered element is not a `<button>`. The shadcn reflex `<Button asChild><a …/></Button>`
type-errors. Use `buttonVariants` directly on the anchor instead: it is already
exported, carries zero runtime, and sidesteps the `nativeButton` footgun. Match
the `className="h-8"` override `queue.tsx` puts on every action button, because
this Button's `size="sm"` is `h-7`.

---

## Accessibility

The repo already sets every pattern needed, so this is matching rather than
inventing.

**A `<section aria-labelledby>`, not `role="alert"` and not `role="status"`.**
Both interrupt whatever the reader was doing, and `role="alert"` is assertive.
Interrupting **is** a claim of urgency, and not manufacturing urgency it cannot
justify is this feature's central constraint — so the ARIA has to hedge as hard
as the copy. It is also factually the wrong role: these flags arrive with the row
and never change under the reader, so they are not a live region. `StaleBanner`
is the file's only `role="status"` and it is a genuine one — the connection
changed under you.

**Icons are `aria-hidden` throughout.** The tier is already carried by the group
heading and the label text; announcing *"warning triangle"* before every inferred
row is noise that trains people to skip the row.

**`<details>` supplies its own semantics.** Do not add `aria-expanded` to a
`<summary>` — the browser exposes it already, and a hand-added one goes stale on
the first native toggle.

**The thumbnail is `alt=""` plus `aria-hidden`.** The filename sits beside it as
real text, and an `alt` derived from an attacker-controlled filename would read
the same hostile string twice, giving a screen-reader user a second injection
surface with none of the visual defences — no clamp, no `dir`, no mono.

**Button labels are disambiguated by filename** — `aria-label={`${t.email.attachmentDownload} — ${name}`}`
— because three rows of *"Download, Download, Download"* is a navigation dead
end. The visible text stays the single word.

**External-link announcement goes in an `sr-only` span inside the anchor**, not
in a `title` attribute: `title` is unreachable on touch and inconsistently
announced.

**Focus is already handled.** `buttonVariants` carries
`focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`, and
`globals.css` sets `outline-ring/50` on `*`, which the bare `<summary>` elements
inherit. Verify the ring is visible against `bg-muted/40` in both themes rather
than assuming; if it is thin, add `focus-visible:ring-2` to the summary shell
rather than inventing a new focus style.

**Never colour alone**, per the two-mechanism split above.

**No animation on this surface at all**, so `prefers-reduced-motion` needs
nothing new. The only transitions are the chevron rotation and a hover opacity.

Worth fixing while in the file: the existing chevron button at the right of every
queue row carries `aria-label={t.whatWouldBeSent}` and no `aria-expanded`, even
though it is the same control as the title button, which has one.

---

## "Not analysed" is not "nothing found"

Zero flags currently reads as *"this is fine"*. That is the empty-versus-failed
problem `WEB-CHAT-DESIGN.md` already worked through for the recap, with a harder
edge here: the empty state is a **safety claim**, and a safety claim is the one
thing this feature must never make.

There are five states and they must be distinguished in this precedence:

1. **`perms.canModify` is false** → the existing `draftsRestricted` line and no
   analysis section at all. Not *"Not checked"* — that would tell a read-only
   assistant the check failed, when in fact it was never theirs to see. This is
   the denied-versus-failed distinction the code comment already protects.
2. **`todo.source !== "email"`** → no section. Any value other than the literal
   `'email'` counts as not-email; the column is unconstrained `text`.
3. **The fetch is in flight** → the existing `<Skeleton />` treatment. Never
   *"Nothing stood out"* while a request is open.
4. **No `todo_email_analysis` row** → the muted line `notChecked`. Never silence.
   A missing key in the client's flag map means **unknown**, not none, and this
   is why: a todo that arrives before its analysis has been fetched must not
   render a safety claim for the half-second before the fetch lands.
5. **A row exists** → `ok` with flags renders the panel; `ok` with zero flags
   renders `nothingStoodOut`; `partial` renders `partlyChecked` and names what
   was skipped; `failed` renders `checkFailed` in the inferred treatment.

That fifth case is the single most important decision in the feature.
*"Nothing stood out"* is plain muted text in lowercase register — no icon, no
green, no tick, no border, no badge. A green *"No risks found"* chip would
convert every false negative into an endorsement by Dovis, and a targeted
spear-phish is precisely the message that will carry it. The product reports what
it noticed; it never asserts safety.

A `failed` result must never sit visually adjacent to a clean one. *"The check
did not finish"* and *"Nothing stood out"* are opposite facts, and a reader who
has to distinguish them by reading carefully will one day not.

---

## Demo fixtures

`demo-data.ts` is what the public showcase renders, and its own comment states
the standard: *"The content is written to show the product honestly… including
one failure. A demo where everything succeeds hides the part of the design that
matters most."* The same obligation applies here twice over: a demo where every
message is clean hides the entire feature, and a demo where every attachment
loads hides the state that is hardest to get right.

Demo mode is part of the contract, not an afterthought. `dovis-provider.tsx`
short-circuits `loadPayload` with `if (isDemoMode) return payloads[todoId] ?? null`,
so `/api/payload/[id]` is never reached and the fixtures must carry
`flag_evidence` themselves. Every existing entry in `demoPayloads` gains
`flag_evidence: {}` — required, not optional, and the compiler will name all
eight. New `demoFlags`, `demoAnalysis` and `demoAttachments` records are seeded
into the provider the same way.

The showcase needs one hostile item, and the details matter:

- **`action_type: "manual"`**, not `draft_email`. This is the one item a boss
  must not act on, and `manual` means confirming only marks it done. The demo
  should not show Dovis proposing a reply to a suspected fraud.
- **The flag set is the supplier-invoice fraud shape** — a new contact on a free
  mailbox, a domain that does not match the company named, urgency, a payment
  request, and a PDF. It puts flags in both tiers so both visual mechanisms
  appear side by side, and it is the only fixture whose collapsed row shows a
  chip, which is what makes the chip's rarity legible.
- **Its flags must agree with its attachments.** If the payload lists a `.jpg`,
  `image_attachment` is in the flag list. A fixture whose analysis contradicts
  its own contents is the worst possible advertisement for a feature whose whole
  claim is that the flags are trustworthy.
- **One attachment in `preview: "failed"` and one in `preview: "none"`**, so the
  two are demonstrably different sentences rather than one greyed row.
- **One link whose label lies and whose punycode hostname is visible above it**,
  with `safety: "blocked"` so there is no anchor to tap. That single fixture is
  the entire link design in one row.
- **One `demoAnalysis` entry with `state: "partial"`**, and at least one
  email-sourced todo with **no** analysis row at all, so *"Not checked"* and
  *"Nothing stood out"* are demonstrable rather than described.
- **A benign mime disagreement** — an `.xlsx` sent with the legacy declared type
  — so the card shows that a mismatch is *inspectable* and not automatically
  alarming, which is why the schema stores both columns and raises no flag for
  the difference.

Two knock-on edits nobody will think of. Adding a ninth `proposed` item makes
`page.tsx` compute `waiting` as 5 while widget `w1` is a hardcoded `"4"` — the
briefing must agree with the queue directly beneath it. And no attachment control
in demo mode may emit a request: an `<img src="/api/attachment/…">` is a browser
request that bypasses `isDemoMode` entirely and returns a 401 with a console
error on a deployment that has no service-role key. `isDemoMode` guards the
provider, not the DOM.

`tests/payload-route.test.ts` also breaks. Its `stubAdmin()` models exactly one
chain — `from().select().eq().maybeSingle()` — so a second query returns the
payload stub or throws. Extend the stub to dispatch on table name in the same
commit, and add a case asserting a `can_modify` assistant is refused by
`/api/attachment/[id]` while the owner is not. That assertion is the whole point
of the owner-only decision.

---

## Retention, and a promise the danger zone currently makes

`clearCompletedHint` says, in both languages, that clearing *"deletes every done
and rejected item, and the drafts recorded against them."* After this feature
that sentence is incomplete, and both dictionary entries need the analysis added
— `Record<Lang, Dict>` will not catch a string that is merely wrong.

The cascade handles everything in Postgres. It cannot reach the derived preview
files on the box, because they are files. Two options, and the recommendation is
the second: delete them from the same route that deletes the rows (which makes
the dashboard call the box, a new dependency for a cleanup path), or run a reaper
on the box keyed on preview keys whose attachment row no longer exists. Say which
in the schema comment, because *"the danger zone clears everything"* stops being
true the moment neither is built, and a silently growing store of the boss's mail
attachments is the worst thing this feature could leave behind.

That is also the argument for the retention shape recommended here: **the box
holds derived previews and never the originals.** Originals are fetched from
Gmail on demand with the owner's credential and streamed through without touching
disk. The costs are honest — latency on every open, and an attachment that
`unavailable`s once the boss deletes the mail — and the benefit is that Dovis
never becomes a second archive of every invoice, contract and scan the boss has
ever received. That is a retention decision before it is a technical one, and it
is recorded below as Aaron's.

---

## Content-Security-Policy

`next.config.ts` sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and
`Permissions-Policy`, and **no CSP at all**. That was tolerable while the app
rendered only escaped text with no external resources and no anchors — `grep`
confirms there is not one external `<a>` in `src/`. This feature breaks both
conditions: it adds the first `<img>` whose subject is influenced by mail, the
first same-origin binary endpoint, and the first outbound links. Without a CSP,
one mistake in the content-type allowlist is unbounded.

The minimum policy:

```
default-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none';
base-uri 'self'; form-action 'self';
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co
```

Three things in this repo break under it, and they are not all cosmetic, so this
is its own piece of work rather than a config edit.

`next-themes` renders its anti-flash script with `dangerouslySetInnerHTML`, and
`theme-provider.tsx` documents the dependency in its own comment — *"next-themes
injects a blocking script so the correct palette paints on the first frame rather
than flashing the wrong one."* Blocking it does not error visibly; it flashes the
wrong palette on every load. `next-themes` accepts a `nonce` prop and forwards it
to that script and to the `disableTransitionOnChange` style it injects, which is
what makes a nonce worth the work rather than a purity argument. There is no
`middleware.ts` in this repo, so the nonce has to be minted in the layout or a
middleware has to be added — say which.

`layout.tsx` sets the three font custom properties as a `style` attribute on
`<html>`, which needs `style-src 'unsafe-inline'` — or, better, move those three
declarations into `globals.css`, which is a two-line change and removes the need.

The `wss:` origin is mandatory. `supabase/client.ts` runs `createBrowserClient`
in the browser, so Realtime dials Supabase directly from the page; omitting it
makes the queue silently stop updating, which is the same failure class
`schema.sql` §5 already warns about for the publication and which looks like a
frontend bug rather than a header.

The per-response policy on the attachment route is separate, stricter, and both
are needed.

While in the neighbourhood: `/api/google/status` returns `credentialsDir`
(defaulting to `/home/jarvis/mcp-google-workspace`) and `tokenFilePattern`
(`.oauth2.{email}.json`), which together give the absolute path of the OAuth
refresh token on the box. `WEB-CHAT-DESIGN.md` already records this and says the
rule *"we never leak paths"* is currently untrue and should not be asserted. It
is owner-only, so it is not privilege escalation — it is a blast-radius
amplifier, and this feature raises the cost of leaving it, because a wrong
content-type header here would be the XSS that makes it matter. It is a leak to
stop repeating, not a precedent for this route to follow.

---

## Failure modes

| Failure | Observable symptom | Mitigation |
|---|---|---|
| The analyser writes flags but no analysis row, or vice versa | A card with a chip and *"Not checked"*, or an empty panel | The row is the state; flags without a row render nothing. Write both in one transaction on the box, and treat a missing row as unknown rather than clean. |
| A model emits a code the CHECK rejects | The insert fails; no flag appears | The intended failure, by name rather than silently. Adding a code means CHECK, union, `FLAG_BASIS`, and both dictionaries. |
| A model emits a code that passes the CHECK but has no dictionary key | A styled chip with no words | `isEmailFlagCode` drops it on the way in, and the render guards `if (!label) return null`. Two barriers, because the dictionary assertion does not cover this union. |
| An inferred flag with an empty `cites` array | An accusation with no evidence | Enforced in the database — a CHECK rejecting `basis = 'model'` with `jsonb_array_length(cites) = 0` — so a model ignoring the instruction produces a rejected insert rather than an unfounded claim on the boss's screen. |
| A filename carrying a right-to-left override | `report-‮fdp.exe` shown as `report-exe.pdf`; the boss runs an executable he was shown as an image | `sanitizeDisplay()` at render plus `dir="ltr"`. At render, not only at write, because rows predate the fix. |
| An HTML attachment served with its declared type | Stored XSS on the dashboard origin, with full session takeover | Magic-byte allowlist, `nosniff`, forced `attachment` for anything unrecognised, and the per-response `sandbox` CSP. Four independent barriers because the consequence is total. |
| The Gmail message was deleted, or the attachment id rotated | `unavailable` on an item that worked yesterday | Routine, not exceptional, and the copy says *Dovis could not fetch this* rather than blaming the boss. This is the cost of not keeping originals, and it is the cost that was chosen. |
| A thumbnail fails to generate | The unavailable tile | Must **never** fall back to rendering the original bytes — that fallback is how a decoder bomb reaches the browser. |
| The analyser cannot reach the mailbox history | `new_contact` silently absent | Absence of *"New contact"* reads as *"you know this person"* — a false reassurance produced by an outage. The run reports `partial` and names the missing source; it never reports `ok` over a hole. |
| The CSP ships without `wss:` | The queue looks frozen; no error anywhere | Named in the CSP section. It is a header bug that presents as a frontend bug. |
| A flag arrives while the owner is reaching for Confirm | A warning landing on, or just after, an approval | Cannot happen: none of these tables is in the realtime publication, so flags arrive with the snapshot of the queue they belong to. |
| Attachment blobs outlive the queue rows | A silently growing archive of the boss's mail that the danger zone cannot clear | Originals are never stored. Derived previews need a reaper, and the danger-zone copy needs a sentence in both languages. |
| Someone adds `todos.has_risk_flag` for the collapsed chip | Every flag write broadcasts the full old and new row to every subscribed browser | Refuse it. The flags for every visible todo are already in client state from the same fetch, so it buys nothing and costs the publication. |

---

## Verification

Mirroring `WEB-CHAT-DESIGN.md`'s bar rather than inventing a different one.

`npx tsc --noEmit` and `npm run build`, both clean.

`npm run test` — the extended `payload-route.test.ts`, plus a new
`attachment-route.test.ts` asserting the three-way outcome: owner 200, assistant
with `can_modify` 403, assistant without 403, and a paused account 403 through
`requireProfile`. Assert the response headers on the 200, because the
content-type allowlist is the barrier that carries the most consequence and it is
the one nobody will notice regressing.

Run section 7 against a scratch Supabase project before committing, and check
that the generated `basis` column actually populates — a `GENERATED ALWAYS AS …
STORED` expression over a text column is standard PG12+, but it was not run
against an instance while this was written and should not be assumed.

Screenshots at **375 and 1440, in both languages, in both themes**, of: a clean
card, a card with one inferred flag, the hostile fixture with the collapsed chip,
an expanded panel with attachments in all six states, and the four analysis
states. Both themes is not optional here — a warning invisible in one of them is
a warning that did not fire.

Read the expanded panel in greyscale and confirm the two tiers still separate.

Sign in as an assistant with `can_modify` and confirm: flags visible, evidence
visible, attachment metadata visible, every open and download control replaced by
`attachmentOwnerOnly`, and a direct `GET /api/attachment/<uuid>` returning 403.
Then as a read-only assistant and confirm no analysis section renders at all and
`todo_flags` returns zero rows through PostgREST.

Then the anon check the schema already models, extended:

```bash
# Must all be empty. Rows coming back mean analysis of the principal's mail is
# readable by anyone holding the publishable key.
for t in todo_email_analysis todo_flags todo_attachments todo_attachment_sources; do
  curl -s "$SUPABASE_URL/rest/v1/$t?select=todo_id" -H "apikey: $SUPABASE_ANON_KEY"
done
```

And after the first real `clear-completed`, the orphan check from §7.7 returning
zero.

Finally, per the deployment-targets section of `WEB-CHAT-DESIGN.md`: verifying
against `dovis-dashboard.vercel.app` proves only that the template built. The
template runs in demo mode, where no attachment route can execute at all.
Anything operational is confirmed against the private deployment after Hermes has
replicated it.

---

## Open questions — Aaron's calls

1. **Does the box's Gmail tool return raw headers?** `Reply-To`,
   `List-Unsubscribe`, `Precedence`, `Auto-Submitted`, and
   `Authentication-Results`. Nothing in this repo documents the tool surface.
   Without them, `newsletter_or_marketing` and `receipt_or_automated` have no
   mechanical source and should ship as unemitted codes rather than as model
   guesses. If `Authentication-Results` **is** available, note the parsing trap
   that would otherwise invert its meaning: a message can arrive carrying forged
   `Authentication-Results` headers written by the sender, so only the line whose
   authserv-id is the receiving domain's is trustworthy, and it is not
   necessarily the first one.
2. **Does the box expose message search, and is one search per proposal
   acceptable in latency and quota?** `new_contact` and `new_company` are
   unimplementable without it, and implementing them against Dovis's own memory
   instead makes every sender new for the first fortnight — which is worse than
   not shipping them.
3. **Structured evidence, or genuine model prose?** This design recommends
   structured, and it is the single decision that changes the most code. Prose
   is what a later model reading `/api/recap` would consume as trusted analysis,
   which is second-order injection; slots cannot carry an instruction. If prose
   wins anyway, it needs a 240-character server-side cap, a quotation frame
   attributing it to the message rather than to Dovis, bidi stripping, no links
   inside it, and it never appears on a collapsed card.
4. **Do you accept the citation rule** — that an inferred flag cannot display
   without naming at least one observed flag on the same message? It is the
   strongest available brake on false positives and is enforceable as a CHECK,
   but it means some genuine model intuitions are suppressed for want of a
   citable fact.
5. **Attachment bytes: owner-only, as designed here?** The alternative is the
   `can_modify` gate that governs drafts. The argument for owner-only is that an
   attachment is the third party's original document rather than your mail
   rewritten, and you removed mailbox access from assistants entirely hours
   before this was specified. It can be widened later without a migration;
   narrowing later means the assistant already saw the files.
6. **Should a `can_modify` assistant see attachment filenames at all?** This
   design says yes — name, size and type, enough to triage what needs you. The
   stricter reading says no, because a filename is a verbatim string the sender
   chose and `Q3-layoff-list.xlsx` says a great deal on its own. The middle
   option is a Dovis-derived shape line — *"2 attachments · 1 PDF, 1 image ·
   1.4 MB"* — with no filenames.
7. **Retention: on-demand fetch with derived previews cached, as recommended?**
   The alternative is caching originals on the box, which gives instant previews
   and durable access at the cost of Dovis holding a second copy of every
   document anyone has ever mailed you. If originals are cached, name the storage
   root explicitly and make sure it is not the credentials directory
   `src/lib/google.ts` points at.
8. **Do you want an "open the original in Gmail" affordance?** The message id is
   genuinely low-sensitivity — it sits in your own URL bar when you open the mail
   — but your 2026-09-05 decision forecloses handing an assistant any mailbox
   locator, so it is tier 3 here. If you want the jump, it should be an
   owner-only route that redirects, not an id in the browser.
9. **Can a flag be removed on re-analysis?** The primary key `(todo_id, code)`
   makes upsert natural, but a flag that appears and later vanishes is a
   different product promise from one that only accumulates. The instinct here
   matches the recap reasoning: a risk flag that stops being shown has been
   hidden, not resolved. If you agree, the analyser only ever adds, and a
   downgrade is expressed in the evidence rather than by deletion.
10. **Do you want a one-tap correction on an inferred flag?** This product
    already learns from being wrong — `payload_proposed` is never overwritten so
    the diff is a labelled correction, and `rejectPrompt` says a rejection
    teaches Dovis more than a confirmation. A flag that cannot be contradicted is
    the one assertion in Dovis that gets to be wrong for free, and it is an
    assertion about a named human being. It would need its own append-only table
    and its own route — `/api/act` refuses anything not `proposed`, and the
    moment a flag is most usefully contradicted is after the decision. If yes,
    the dismissal must never silently suppress that flag for that sender in
    future: suppression, if offered at all, is per-sender, visible in one place,
    reversible, and suppresses prominence rather than the flag.
11. **Which domains count as a free mailbox, and what is your own domain?**
    gmail.com and outlook.com are easy; proton.me, icloud.com and regional
    providers are judgement calls, and a wrong list produces confident false
    positives. The second half is what *external link* and *external sender* are
    measured against, and there is nowhere in the schema holding it today.
12. **Does the safe-URL validator do anything beyond scheme and userinfo
    checks?** Anything richer is an outbound fetch driven by an attacker-supplied
    URL, which `WEB-CHAT-DESIGN.md` names as the wrong capability for an
    injection-adjacent run. If it does not, `linkNotClickable` should be softened
    in both languages, because *"did not pass the check"* currently implies more
    than a scheme test.
13. **Sixteen flags is a lot of surface for v1.** Would you rather ship the seven
    inferred flags plus `attachment_received`, `pdf_attachment`,
    `image_attachment` and `external_links` first — the ones that change a
    decision or are free from MIME structure — and add the remaining five once
    you can see what the analyser actually emits and at what rate? Everything is
    additive per flag, so nothing is wasted, and the deferred five are the ones a
    boss would skim anyway.
14. **Where does the composition rule live?** *New contact* plus *free mailbox*
    plus *mentions a payment* is the classic supplier-invoice fraud shape, and
    under the rules here none of the three is inferred, so nothing reaches the
    collapsed row. The position taken here is that the UI stays dumb — it renders
    the tier of what it was sent — and the analyser on the box emits
    `possible_scam` when it sees the combination. If the dashboard computed it
    instead, the taxonomy would have a second definition and the two would drift.
15. **Should `ADDING-FEATURES.md` gain a fifth section, "Add a flag — four
    places"?** `schema.sql`, `types.ts` and `i18n.ts` now each enumerate the same
    sixteen codes, and two of the three fail the build on drift. The box is the
    fourth copy and nothing checks it. That file already documents exactly this
    problem for widget types and action types and is currently silent on flags.
16. **Does the CSP ship with this feature or separately?** It was hygiene before
    this change and is load-bearing after it, but it needs a nonce threaded
    through the layout for `next-themes` and it will break the queue silently if
    the `wss:` origin is wrong. It is real work, not a config edit.
