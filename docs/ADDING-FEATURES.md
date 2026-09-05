# Adding to the Dovis dashboard

Four kinds of change, in order of how much they cost.

---

## 1. Add a widget — no code, no deploy

Widgets are **rows**, not components. `AGENTS.md` is explicit about this:

> Widgets are data, not code. To add one, INSERT a row in `dashboard_widgets` with
> a `widget_type` from: metric, chart, list, checklist, approval. **Never write
> JavaScript into the plugin directory and never generate a plugin bundle from a
> chat message.**

So Dovis itself can add a widget, and cannot add code. That is the point.

```sql
insert into public.dashboard_widgets (widget_type, title, config, position)
values (
  'list',
  'Contracts expiring',
  '{"kind":"list","items":[
      {"label":"Warehouse lease","meta":"31 days"},
      {"label":"Insurance","meta":"12 days"}
   ]}'::jsonb,
  6
);
```

It appears immediately — Realtime is subscribed to `dashboard_widgets`, so no
reload and no deploy.

### The five types and their `config` shapes

| `widget_type` | `config` |
|---|---|
| `metric` | `{"kind":"metric","value":"4","caption":"…","delta":"+6"}` |
| `chart` | `{"kind":"chart","unit":"items","series":[{"label":"Mon","value":9}]}` |
| `list` | `{"kind":"list","items":[{"label":"…","meta":"…"}]}` |
| `checklist` | `{"kind":"checklist","items":[{"label":"…","done":false}]}` |
| `approval` | `{"kind":"approval","note":"…"}` |

`metric` renders in the band across the top. Everything else renders as a card.

A row with an unrecognised `widget_type`, or a malformed `config`, renders as
**nothing** — deliberately. A bad row must not be able to take the briefing
offline.

---

## 2. Add a sixth widget type — small code change

Three places, all typed, all of which the compiler will point at:

1. **`supabase/schema.sql`** — add the value to the `CHECK` constraint on
   `dashboard_widgets.widget_type`, and run the `ALTER`:
   ```sql
   alter table public.dashboard_widgets drop constraint dashboard_widgets_widget_type_check;
   alter table public.dashboard_widgets add constraint dashboard_widgets_widget_type_check
     check (widget_type in ('metric','chart','list','checklist','approval','timeline'));
   ```
2. **`src/lib/types.ts`** — add a variant to `WidgetType` and to the `WidgetConfig`
   union.
3. **`src/components/widgets.tsx`** — add a `case` to `renderBody`.

Miss step 1 and the insert is rejected by Postgres rather than half-working. That
is the intended failure.

---

## 3. Add an action type — the expensive one

**Read this before adding one.** `action_type` is not a label; it is the list of
things the agent is permitted to do, and it is enforced by a `CHECK` constraint
so the agent cannot widen it by writing a different string.

There are exactly two:

| `action_type` | Behaviour |
|---|---|
| `draft_email` | On confirm, writes a draft into the principal's Gmail. `done` means *the draft is waiting*, never *it was sent*. |
| `manual` | Dovis cannot do this. Confirming only marks it done. |

**There is no `send_email` and there must not be one.** No tool on the box can
send mail — `gmail_reply` is excluded from the allowlist and `GMAIL_ALLOW_SENDING`
is unset. An action type describing something the executor cannot do would make
the executor either fail every such item or mark one `done` having not done it,
and `AGENTS.md` forbids exactly that.

To add a genuine new capability:

1. **Give the agent a tool that performs it**, and add that tool to the allowlist
   on the box. Without this, stop — the rest is theatre.
2. `supabase/schema.sql` — extend the `CHECK` on `todos.action_type`.
3. `src/lib/types.ts` — extend `ActionType`, and add a payload interface.
4. `src/lib/i18n.ts` — add a label under `action` in **both** languages. The
   `languages` assertion fails the build if you only do one.
5. `src/components/queue.tsx` — handle it in `PayloadView`, and pick an icon.
6. **Teach the executor** on the box to handle the new type before you insert a
   single row of it.

Then test with a real item of the new type. Testing with a `manual` item proves
nothing: `manual` stamps `done` without acting, so it passes even when the
executor is completely broken.

**When *not* to propose one at all** is the other half of this, and it lives in
`QUEUE-POLICY.md`. A todo is created only when a message needs a concrete
decision or task from the principal; important informational mail is summarised
without one, and routine mail leaves nothing but a count. Read it before teaching
the executor to insert rows of a new type — an action type with a real tool
behind it can still ruin the queue by being used on everything that arrives.

---

## 4. Add a page

```
src/app/your-page/page.tsx
```

```tsx
"use client";

import { Header } from "@/components/chrome";
import { Gate } from "@/components/gate";

export default function YourPage() {
  return (
    <Gate>                      {/* <Gate requireOwner> for owner-only */}
      <Header />
      <main className="flex-1 w-full mx-auto max-w-5xl px-5 py-10">
        …
      </main>
    </Gate>
  );
}
```

Add it to the `<nav>` in `src/components/chrome.tsx`.

**`Gate` is convenience, not security.** It redirects; it does not protect. Every
real protection is in the RLS policies and in the server routes, which re-check
the session and role on every call. If a new page reads sensitive data, the
protection goes in the route handler — never in the component.

### If the page needs a new server route

Copy the shape from `src/app/api/team/update/route.ts`:

```ts
const auth = await requireProfile();
if (isFailure(auth))
  return NextResponse.json({ error: auth.error }, { status: auth.status });

if (auth.profile.role !== "owner")
  return NextResponse.json({ error: "Only the owner can do that." }, { status: 403 });
```

`requireProfile()` also refuses **paused** accounts, whose JWT stays valid until
it expires. Never skip it.

---

## 5. Add a language

`src/lib/i18n.ts`. Add the code to `Lang`, then a full block to `dict`.

```ts
export type Lang = "en" | "zh-TW" | "ja";
```

You do not need to hunt for missing strings. This line:

```ts
export const languages: Record<Lang, Dict> = dict;
```

fails the build and names every key you left out. A missing translation is a
compile error, not `undefined` appearing mid-sentence in front of a boss.

Traditional Chinese uses **Taiwan** vocabulary per `SOUL.md` — 軟體 not 軟件,
資料 not 数据, 快取 not 緩存, 程式 not 程序.

No Chinese webfont is loaded; the stack in `src/app/layout.tsx` falls through to
the system face. If you add a language whose script is not on the OS, that is the
one case where a webfont is justified.

### What the dictionary does *not* cover

Switching to 繁中 translates the **chrome** — navigation, buttons, statuses,
warnings. It does not translate **content**: `todos.title`, widget titles, and
draft bodies stay exactly as they are in the database.

That is correct, not a gap. Those strings are written by Dovis, which is itself
bilingual and matches the language the principal writes in (`SOUL.md`, Voice). A
dashboard that machine-translated a drafted email would be showing the principal
something other than what would actually be sent — and the entire product is
built on the promise that what you approve is what goes out.

---

## 6. Later: the web assistant

Planned, not built. The design decision is already made, so record it here rather
than rediscover it:

The web chat should call **the Hermes gateway on the box**, not an LLM API from
this app. Reasons, in order:

1. **It is the same Dovis.** Same vault, same memory, same person it has been
   learning. A separate API key is a second, dumber assistant that shares a
   name — and a conversation started on the web would not continue on Telegram.
2. **It costs nothing extra.** The box authenticates Codex with a ChatGPT
   subscription. A ChatGPT subscription grants no API credit, so a key in this
   app's environment is a second bill.
3. **No key in this app.** The service_role key is already the most dangerous
   thing here; adding a model key is a second secret to leak.

Requirements before building it: a reachable ingress to the box (Cloudflare
Tunnel with a service token — the same tunnel already fronting this dashboard),
and confirmation that Hermes exposes an HTTP chat endpoint with resumable session
IDs. **That second point is unverified.** Check it against the box before
promising shared memory between web and Telegram.

---

## Before you commit

```bash
npx tsc --noEmit
npm run build
```

Both must be clean. And check `git status` **before** committing, not after
pushing — `.env.local` and any credential file must never enter the repository.
