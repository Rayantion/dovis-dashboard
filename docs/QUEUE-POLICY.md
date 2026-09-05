# Queue policy — what becomes an action item

**Status: decided 2026-09-05. Enforced on the box, not in this repository.**
This is the companion to `ADDING-FEATURES.md` §3. That section says when an
action *type* may exist at all; this one says when a row of an existing type may
be written — a narrower question, and the one that gets asked every few minutes,
for every message that arrives.

The deployment owner: *"Do not turn every important email into an action item.
Only create a todo when the email requires a concrete decision or action from the
principal."*

---

## The three outcomes

| Outcome | What it is | Where it goes |
|---|---|---|
| **Action** | A concrete decision or task for the principal | a `todos` row, with Confirm / Modify / Reject |
| **Briefing or alert** | Important, informational or security-relevant; needs no reply and no immediate task | summarised, **without a todo** |
| **Ignore or archive** | Newsletters, receipts, routine automated notices, anything already handled | nothing, beyond the count of what was handled |

The third outcome already has its whole representation in the product, and it is
one number. The demo's metric band carries *"Handled without you — 27, filed,
ignored, or answered"*, and that is deliberately all of it. A readable list of
everything Dovis chose to ignore is a second inbox, which is the thing the
principal acquired the first one to stop reading.

The split is **not by importance**. A message can be the most significant thing
that arrived all week and still be outcome 2: a wire transfer that cleared, a
contract that came back counter-signed, a security notice about a token that is
exactly what it should be. Importance decides whether the principal is *told*.
An open decision decides whether the principal is *asked*.

## The test that separates a decision from information

Three conditions, and an item needs all three to be a todo.

**There is a specific act, nameable in one line**, without the words *review*,
*monitor*, *be aware of* or *keep an eye on*. If the best sentence available
begins "be aware that", the sentence is a briefing, and putting three buttons
under it does not change what it is.

**It is open.** Nobody has done it, the sender is not already handling it, and
the passage of time will not resolve it. An already-handled message is outcome 3
however dramatic it reads.

**It is the principal's to make.** Not the sender's next move, not something an
assistant is already doing, not something Dovis has done and is reporting.

The blunt version of the test is the buttons. A queue card offers exactly three
answers, and one of them is **Reject**. Ask what Reject would mean against the
item in front of you. You cannot reject the fact that a token was created, that a
payment cleared, or that a supplier has moved office — there is nothing there to
decline. **When Reject is a nonsense answer, the card is a briefing wearing
decision buttons**, and the small hesitation the reader feels before pressing
anything is the design telling you the row is in the wrong place.

## The worked example: a GitHub security notice

The deployment owner supplied this one, and it is worth taking both ways, because
the same message lands on either side of the line depending on a single thing.

**As an alert, which is the normal case.** GitHub emails that a new personal
access token was created. Dovis recognises the token, or has nothing to say
against it. There is no act for the principal here: the token exists, the notice
is a record, and every available response is *noted*. It belongs in the briefing —
one line, saying what it was and when — and it creates no todo. A "reply to
GitHub" task would be worse than useless: nothing on the box can send the reply,
and the recipient is an automated address that would not read one.

**As an action, which is the exception.** Dovis checks the token against what it
knows and cannot account for it — an unfamiliar machine, a scope nobody asked
for, a time nobody was working. Now there is a decision with two real outcomes
and exactly one person who can pick: **revoke it, or keep it.** That is a
`manual` item, because no tool on the box can revoke anything at GitHub, and the
card says where to go and what the choice is. The rule the owner stated is this
narrow: *only create a manual proposal if Dovis identifies a specific decision,
such as whether to revoke an unrecognised token.*

**What flips it is Dovis's finding, never the notice's tone.** Security mail is
written to alarm, by design; every one of these messages ends with some version
of *"if this wasn't you, act immediately"*. If that sentence were the trigger,
every routine notice becomes a todo and the policy has inverted itself. The
schema already says this about the neighbouring field — `todos.attention_reason`
must name *"a deadline, a commitment, an amount, a risk. Judge from those, never
from how urgently the sender wrote — a stranger able to set this column by typing
URGENT is a stranger setting the dashboard's alarm."* The same sentence governs
whether the row should exist at all.

## Where a briefing item actually lives

"Do not create a todo" is half an instruction. The other half is that the
information still has to reach the principal, and this dashboard has exactly two
tables to put a row in: `todos` and `dashboard_widgets`.

**Not a todo, and not merely by convention.** Every `todos` row is an action by
construction. The card renders Confirm / Modify / Reject, the row carries a
`status`, a `confirmed_at` and a `completed_at`, and the briefing headline counts
`proposed` rows into the one sentence at the top of the page. Inserting an
informational row does not produce a quiet informational card. It produces a
decision card nobody can answer, and it inflates the number that tells the
principal how much is waiting on them.

**A widget is the shape that already fits.** Widgets are rows, not code
(`ADDING-FEATURES.md` §1), so the box adds one by INSERT and it appears without a
deploy — `dashboard_widgets` is in the realtime publication. A `list` widget is a
title and lines of `{label, meta}`, rendered as a card with no controls on it at
all, which is what a briefing item is. The demo already ships one and nobody has
ever mistaken it for a queue: *"People waiting on a reply"*, three rows and how
long each has been waiting.

```sql
insert into public.dashboard_widgets (widget_type, title, config, position)
values (
  'list',
  'Noted, no action needed',
  '{"kind":"list","items":[
      {"label":"GitHub — new access token on the build machine","meta":"09:14"},
      {"label":"Insurance renewal confirmed received","meta":"yesterday"}
   ]}'::jsonb,
  7
);
```

That is the entire implementation of outcome 2 today. If the item is one sentence
rather than a list, `approval` renders a single paragraph of prose — but read its
`case` in `widgets.tsx` before trusting the name: it draws a `<p>` and nothing
else. **No widget of any type carries a control.** Nothing on the briefing can be
approved, and that type name is not permission to put a decision there.

**What a widget cannot do, stated plainly, because it decides how this gets
used.** `dashboard_widgets` has five columns: `id`, `widget_type`, `title`,
`config`, `position`. There is no timestamp, no severity, no seen-state and no
dismissal. A card therefore stands until the box rewrites or deletes the row; the
principal cannot clear it, an assistant certainly cannot (insert, update and
delete are all owner-only in RLS, and the box's `service_role` bypasses that),
and the queue's `clear-completed` route has no widget equivalent. So a widget
suits **a standing summary rewritten on a cadence**, and suits a one-off alarm
badly.

**And a widget is not private.** Its select policy is every active authenticated
account, assistants included, and it streams over Realtime with `REPLICA IDENTITY
FULL` — the same exposure `todos.title` already has. What it does not have is the
containment that protects `todos.attention`: that column is a closed set of five
values translated by key lookup, *"so the dashboard translates by key lookup and
a sender can never author the words a boss reads."* A widget title is free text
rendered verbatim, and nothing stops a subject line being pasted into it.
**Write it as though something did** — the words on a briefing card are Dovis's
own summary, never a fragment of somebody else's message.

**The recap covers the time-bounded version, and the recap is not built.**
`WEB-CHAT-DESIGN.md` already specifies it: a read-only turn summarising
*"relevant mail, calendar changes and upcoming meetings, new and changed queue
items, decisions, unresolved conversations, anything urgent"* since the principal
last looked, which *"must not draft or send mail, create calendar events, touch a
todo"*. That is outcome 2 in prose, designed and unbuilt, and its prohibition on
touching a todo is this policy stated from the other end. But the recap is
**pull**: it happens when the principal asks to be caught up. So the split
between the two homes is a real one — **anything that can wait for the next
review belongs in the recap; anything that should be on screen without being
asked for belongs in a widget.**

There is a third destination that costs this repository nothing: the box already
speaks to the principal on Telegram, and a message there creates no row anywhere.
For an alert that matters this afternoon and matters nowhere tomorrow, that is
the honest home, and leaving no row behind is the feature rather than the gap.

**If it ever needs schema.** Not a new table. The smallest honest change, should
the deployment owner later want alerts that are dated, ranked and dismissible, is
a sixth widget type through the three steps `ADDING-FEATURES.md` §2 already
describes — the `CHECK`, the `WidgetConfig` variant, the `renderBody` case:

```sql
alter table public.dashboard_widgets drop constraint dashboard_widgets_widget_type_check;
alter table public.dashboard_widgets add constraint dashboard_widgets_widget_type_check
  check (widget_type in ('metric','chart','list','checklist','approval','alert'));
```

with each item's level drawn from the `attention` vocabulary that already exists,
so one closed set of words covers both surfaces rather than two sets that drift.
**None of this is built and nothing has asked for it.** A separate `briefings`
table would cost a policy set, a publication entry, a fetch in
`dovis-provider.tsx`, a component, demo fixtures and a second contract to keep in
step with the box — and it buys nothing a `list` row does not already do, until
somebody produces a complaint a `list` row cannot answer.

## Why this is a box-side decision first

The dashboard has no classifier and never sees an email. Nothing under `src/`
reads a mailbox; `todos` rows arrive already made, written from the box under
`service_role`, and this application never creates a queue row or authors what
one proposes. It moves rows between statuses in `/api/act`, recording with the
transition the note a `modify` or `reject` carries, and deletes rows outright
from the two owner-only routes under `/api/queue`. By the time a row reaches a
browser, the decision this document is about was taken somewhere else, minutes
ago.

A `CHECK` constraint cannot help here, and it is worth being exact about why.
`todos.action_type` is enforceable because a wrong value is a *different string* —
an executor attempting `send_email` is rejected by Postgres before anything
renders. "This newsletter needed a decision" is not a different string. It is a
well-formed `manual` row with a bad judgement inside it, and no constraint
expressible in SQL separates the two. **So the policy lives in the analyser on
the box: in what it is told to propose, and in the code path that inserts.** This
file is where that instruction is written down; it is not where it is enforced.

What the dashboard can do is refuse to absorb the mistake quietly.

The briefing headline counts `proposed` items into one sentence — *"3 things
waiting on you"* — and that number is the product's single honest signal.
Misfiled informational rows inflate it, on the surface the principal reads first,
before anything else on the page. That is the alarm, and it works only for as
long as nothing tidies it away.

Which is why the dashboard **must not grow a filter**. A "hide informational"
toggle, a severity sort, a collapsed section for the low-value rows: each one
makes a bad queue comfortable and removes the pressure that would have fixed it
at the source. `EMAIL-INTELLIGENCE-DESIGN.md` refuses the same control for the
same reason — *"A queue you can sort by safety is a queue where the dangerous
item is one tap from being out of sight."*

And the correction already has a channel. Rejecting a misfiled item with a reason
writes `reject_reason`, and `payload_proposed` is never overwritten, so the gap
between what was proposed and what came back is *"a labelled correction, produced
free every time the principal edits before confirming. It is what makes the
system learn."* A rejection reading *this needed no decision* is exactly the
signal the box needs, arriving by a path that already exists. Pressing Reject on
a briefing item is the right answer, not a workaround for a missing one.

## The cost of getting it wrong, in each direction

**Too many todos is the failure that matters most in this product.** A queue full
of things that need no decision teaches the principal to skim. Skimming becomes
batch-confirming; batch-confirming becomes not opening it. Nothing looks broken
while that happens — the counts still move, items still reach `done`, the product
still appears to be in use — and the day it costs something is the day the one
item that needed reading goes through with the rest. The entire promise here is
that what you approve is what goes out. An approval given without reading is
worth nothing, and no column on any of these tables can tell the two apart.
`EMAIL-INTELLIGENCE-DESIGN.md` makes the same argument about a flag that is wrong
for a fortnight: attention is spent once, and it gets spent *"in exactly the
period when the product is earning his trust."*

**A decision misfiled as an alert is a decision nobody makes.** It is the rarer
error and the sharper one. A briefing item is counted by nothing, has no status,
no `confirmed_at`, no `completed_at`; nothing chases it and nothing records that
it went unanswered. The invoice asking for changed bank details, filed as a note,
is read once and then it is gone — and the absence of a decision looks identical
to a decision that was made quietly.

**When it is genuinely unclear, prefer the briefing, and name the possible
decision inside it in plain words** — *"if this token is not yours, it should be
revoked."* The two errors are not equally recoverable. A briefing item the
principal reads and judges to be an action can become one on the next run,
because they can simply say so and Dovis writes the todo. A todo the principal
skimmed past cannot be un-skimmed. That preference is not licence to keep the
queue looking tidy: a queue holding two real decisions is the product working,
and an empty one is a valid outcome the briefing already has a sentence for.

## "Never imply that a manual action was performed"

The owner's words, extending the rule already in force: only real supported
actions can be marked done.

`done` is set by the executor on the box, after it has acted, and never by this
dashboard. `/api/act` *"deliberately does NOT perform the action"* — confirming
moves the row to `confirmed`, the cron on the box claims it by writing
`executing`, acts, and only then writes `done`. The route comment names the
reason: a handler that wrote the Gmail draft itself would make the dashboard a
second executor, and two executors race. Demo mode mirrors all three steps on
timers rather than jumping straight to `done`, *"so the demo does not imply the
dashboard performs the action itself."*

What `done` means therefore differs by type, and neither meaning is "it was
carried out". For `draft_email` it means a draft is waiting in Gmail — never that
it was sent, because there is no `send_email` and there must not be one:
`gmail_reply` is off the allowlist and `GMAIL_ALLOW_SENDING` is unset. For
`manual` it means the queue has stopped asking. Dovis did nothing, and the row
says nothing about whether the principal did.

The consequence for wording is direct. A `manual` card is an instruction to a
person and has to read like one — *"Revoke it under Settings → Developer settings
→ Personal access tokens"* — never a report. Past tense is the tell: *"Token
revoked"*, *"Sender blocked"*, *"Reported to GitHub"* each describe something that
did not happen, on the one surface the principal has been asked to trust. This is
the queue-policy end of the rule `ADDING-FEATURES.md` §3 states at the other:
§3 forbids an action type with no tool behind it, and this forbids a card that
implies an act with no tool behind it. `manual` is the honest escape hatch — it
says *this one is yours* — and it stops being honest the moment its title reads
like a completed act.

It is also the second reason a GitHub notice is not a reply task. Nothing can
send the reply, so the card would propose a draft that goes nowhere, in answer to
a notice nobody reads, and mark itself `done` for having produced it.

## What is not decided

**Cadence and ownership of the briefing rows.** One widget rewritten each
morning, or several accumulating and pruned by something. Nothing has been
specified, and nothing in this repository prunes a widget.

**Whether an alert should ever be dismissible**, and therefore whether the sixth
widget type sketched above is wanted at all. Not asked for, not built. It stays
sketched until somebody hits the limit that would justify it.

**Whether an alert the box judges urgent should also reach Telegram
immediately**, rather than waiting to be seen on the briefing. The box already
has that channel and this repository does not govern it, so the decision is
recorded here and made elsewhere.

**Whether outcome 3 should leave any trace beyond a count.** The metric band's
*"Handled without you"* is the whole of it today. A readable list of everything
ignored would be a second inbox; a number nobody can audit is only a number.
Nobody has yet asked for the thing in between, and inventing one before they do
would be building the second inbox by increments.
