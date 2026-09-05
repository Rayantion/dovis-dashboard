"use client";

import * as React from "react";
import { ChevronDown, Mail, Hand, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AttentionBlock } from "@/components/attention";
import { EmailFacts } from "@/components/email-facts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, type Lang } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";
import {
  parseAttachments,
  parseFlagCodes,
  parseLinks,
  type DraftEmailPayload,
  type ManualPayload,
  type Todo,
  type TodoPayload,
  type TodoStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<TodoStatus, string> = {
  proposed: "text-status-proposed border-status-proposed/30 bg-status-proposed/5",
  modifying: "text-status-executing border-status-executing/40 bg-status-executing/10",
  confirmed: "text-status-confirmed border-status-confirmed/30 bg-status-confirmed/8",
  executing:
    "text-status-executing border-status-executing/40 bg-status-executing/10 animate-working",
  done: "text-status-done border-status-done/30 bg-status-done/5",
  rejected: "text-status-rejected border-status-rejected/30 bg-status-rejected/5",
  failed: "text-status-failed border-status-failed/40 bg-status-failed/8",
};

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d`;
}

export function StatusPill({ status }: { status: TodoStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        // Status arrives over the socket and rewrites this pill under the
        // reader's eyes. Easing the colour says "the same row moved on"; a
        // hard cut at the same position reads as a different row arriving.
        "transition-colors motion-reduce:transition-none",
        STATUS_STYLES[status],
      )}
    >
      {t.status[status]}
    </span>
  );
}

export function QueueList({ todos }: { todos: Todo[] }) {
  const { t } = useI18n();

  // Waiting items first — that is the entire reason the page is open. Within a
  // group, oldest first: the thing that has been waiting longest is the rudest
  // to keep waiting.
  const ordered = React.useMemo(() => {
    const rank: Record<TodoStatus, number> = {
      proposed: 0,
      modifying: 1,
      confirmed: 2,
      executing: 2,
      failed: 3,
      done: 4,
      rejected: 5,
    };
    return [...todos].sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [todos]);

  if (ordered.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">{t.queueEmpty}</p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {ordered.map((todo) => (
        <QueueItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}

function QueueItem({ todo }: { todo: Todo }) {
  const { t } = useI18n();
  const { perms, loadPayload, act } = useDovis();
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<TodoPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [dialog, setDialog] = React.useState<"modify" | "reject" | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const decided = todo.status !== "proposed";
  const muted = todo.status === "done" || todo.status === "rejected";

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Without canModify the route answers 403, so asking is a round trip whose
    // only outcome is a denial the panel already knows how to explain. The
    // server check remains the enforcement; this just declines to guess wrong.
    if (next && !payload && perms.canModify) {
      setLoading(true);
      setPayload(await loadPayload(todo.id));
      setLoading(false);
    }
  }

  async function run(action: "confirm" | "modify" | "reject", text?: string) {
    setBusy(true);
    const err = await act(todo.id, action, text);
    setBusy(false);
    if (err) {
      toast.error(err);
      return;
    }
    setDialog(null);
    setNote("");
    if (action === "confirm") toast.success("Confirmed. Dovis is on it.");
  }

  return (
    <article className={cn("group transition-opacity", muted && "opacity-55")}>
      <div className="flex items-start gap-3 px-5 py-4">
        <span className="mt-1 text-muted-foreground shrink-0" aria-hidden>
          {todo.action_type === "draft_email" ? (
            <Mail className="size-4" />
          ) : (
            <Hand className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <button
            onClick={toggle}
            aria-expanded={open}
            className="text-left w-full group/btn"
          >
            <h3
              className={cn(
                "font-heading text-[15px] leading-snug text-foreground group-hover/btn:text-primary transition-colors",
                muted && "line-through",
              )}
            >
              {todo.title}
            </h3>
          </button>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
            <StatusPill status={todo.status} />
            <span>{t.action[todo.action_type]}</span>
            {todo.source ? <span>· {todo.source}</span> : null}
            <span>· {relativeTime(todo.created_at)}</span>
            {todo.priority === "high" ? (
              <span className="text-status-failed font-medium">· priority</span>
            ) : null}
          </div>

          {/*
            Below the meta line rather than in it: the meta line is a row of
            facts about the item, and this is a judgement about it. A row nobody
            has judged renders nothing here and the card closes up — see
            AttentionBlock, which is the only thing that decides that.
          */}
          <AttentionBlock
            level={todo.attention}
            reason={todo.attention_reason}
            className="mt-2.5"
          />

          {/*
            `grid-template-rows: 0fr → 1fr`, not a max-height. A draft can be
            two lines or forty, so any height picked here is wrong twice: it
            clips the long ones, and on the short ones the ease spends most of
            its time crossing space that has nothing in it, which reads as a
            stall and then a snap. A grid row eases to whatever the content
            actually measures.

            The panel stays mounted so it can animate shut as well as open, and
            is `inert` while closed — a zero-height box still holds focusable
            things (the "original proposal" disclosure below), and somewhere the
            keyboard can reach that the eye cannot is worse than no animation.
          */}
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden" inert={!open}>
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3.5">
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ) : payload ? (
                  // Mounts exactly once, when the fetch lands — so the fade
                  // marks the arrival of the draft and never replays on
                  // re-open, when the panel opening is already the signal.
                  <div className="animate-appear">
                    <PayloadView payload={payload} actionType={todo.action_type} />
                  </div>
                ) : (
                  /*
                    Denied and failed are different facts and must not share a
                    sentence. "Could not load" told a read-only assistant the app
                    was broken, when in fact it was working exactly as the owner
                    configured it.
                  */
                  <p className="text-xs text-muted-foreground">
                    {perms.canModify ? t.payloadFailed : t.draftsRestricted}
                  </p>
                )}
              </div>
            </div>
          </div>

          {!decided && perms.canModify ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" className="h-8" disabled={busy} onClick={() => run("confirm")}>
                {t.confirm}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy}
                onClick={() => setDialog("modify")}
              >
                {t.modify}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                disabled={busy}
                onClick={() => setDialog("reject")}
              >
                {t.reject}
              </Button>
            </div>
          ) : null}

          {!decided && !perms.canModify ? (
            <p className="mt-3 text-[11px] text-muted-foreground italic">
              {t.readOnlyHint}
            </p>
          ) : null}
        </div>

        <button
          onClick={toggle}
          aria-label={t.whatWouldBeSent}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">
              {dialog === "modify" ? t.modify : t.reject}
            </DialogTitle>
            <DialogDescription>
              {dialog === "modify" ? t.modifyPrompt : t.rejectPrompt}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t.cancel}
            </Button>
            <Button
              disabled={busy || note.trim().length === 0}
              onClick={() => run(dialog === "modify" ? "modify" : "reject", note.trim())}
            >
              {t.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function PayloadView({
  payload,
  actionType,
}: {
  payload: TodoPayload;
  actionType: Todo["action_type"];
}) {
  const { t } = useI18n();

  if (actionType === "manual")
    return <ManualView payload={payload.payload_current as ManualPayload} />;

  const current = payload.payload_current as DraftEmailPayload;
  const proposed = payload.payload_proposed as DraftEmailPayload;
  const edited = current.body !== proposed.body;

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {t.whatWouldBeSent}
      </div>
      <dl className="text-xs space-y-1">
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-14 shrink-0">To</dt>
          <dd className="text-foreground font-mono break-all">{current.to}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground w-14 shrink-0">Subject</dt>
          <dd className="text-foreground">{current.subject}</dd>
        </div>
      </dl>
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground border-l-2 border-primary/25 pl-3">
        {current.body}
      </p>

      {payload.modify_note ? (
        <div className="pt-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t.whatChanged}
          </div>
          <p className="mt-1 text-xs text-muted-foreground italic">
            “{payload.modify_note}”
          </p>
        </div>
      ) : null}

      {payload.reject_reason ? (
        <div className="pt-1 flex gap-2 text-xs text-status-failed">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <p className="italic">“{payload.reject_reason}”</p>
        </div>
      ) : null}

      {/*
        payload_proposed is never overwritten, so this comparison is always
        available. It is the labelled correction the system learns from.
      */}
      {edited ? (
        <details className="pt-1">
          <summary className="text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground">
            {t.originalProposal}
          </summary>
          <p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground border-l-2 border-border pl-3">
            {proposed.body}
          </p>
        </details>
      ) : null}
    </div>
  );
}

/*
  The manual fields this build has a label for, in reading order rather than the
  order jsonb happens to hold them. `task` and `detail` are not here because they
  render as prose above the table.

  Adding a key to this list can only ever upgrade a raw row to a labelled one — it
  can never hide one, because everything absent from it still renders below.
*/
/*
  Order specified by the deployment owner 2026-09-05, and it is not alphabetical
  or schema order: it descends from what the item IS toward where it came from.
  `event` and `subject` say what this is about, `from` says who raised it,
  `deadline` and `location` are the particulars, and `email_id` is provenance —
  a handle for tracing the item back, not something anybody reads.
*/
const SOURCE_FIELDS = [
  { key: "event", label: "sourceEvent" },
  { key: "subject", label: "sourceSubject" },
  { key: "from", label: "sourceFrom" },
  { key: "deadline", label: "sourceDeadline" },
  { key: "location", label: "sourceLocation" },
  { key: "email_id", label: "sourceMessageRef" },
] as const;

/*
  The three email-facts keys are labelled because EmailFacts below renders every
  one of them properly — a code as a named chip, an attachment as a row, a link
  by its parsed host. Leaving them out would dump the same data a second time as
  raw JSON in the sweep, which teaches the reader that the sweep is noise.

  An unrecognised flag CODE is the different case and is handled separately: it
  renders nothing as a flag, and is put back into the sweep by hand.
*/
const LABELLED_KEYS = new Set<string>([
  "task",
  "detail",
  "email_flags",
  "attachments",
  "links",
  ...SOURCE_FIELDS.map((f) => f.key),
]);

/**
 * A manual item. Nothing in the payload is required and nothing is defaulted:
 * a field that is absent renders as absence, not as a blank row or a dash.
 *
 * Everything below came out of somebody else's mail, so it is rendered exactly the
 * way the draft subject and body beside it are — as text React escapes. No markup
 * path, no auto-linkification of prose, and no "view original": `/api/google/*` is
 * connect, callback and status only, so no route on this app can fetch a message.
 *
 * The one amendment to that: a link the box extracted into `links` can become a
 * real anchor, but only after it passes `checkLink()` AND the reader presses a
 * control saying so. See EmailFacts — nothing on this card is clickable because
 * a message contained it.
 */
function ManualView({ payload }: { payload: ManualPayload }) {
  const { t, lang } = useI18n();

  const task = asText(payload.task);
  const detail = asText(payload.detail);

  /*
    Facts about the message this item came out of. All three fields are absent
    from most payloads and their absence renders as nothing at all — there is no
    "checked, nothing found" line, because this build has no analysis-state
    field and therefore cannot tell that apart from "never checked". A
    reassuring sentence across that gap would be the one claim this surface must
    never make.

    Nothing gates on `todos.source`. It is unconstrained `text` in the schema,
    so it guarantees nothing, and the presence of the fields is the better
    signal anyway: only mail carries MIME parts and a Reply-To header.
  */
  const flags = parseFlagCodes(payload.email_flags);
  const attachments = parseAttachments(payload.attachments);
  const links = parseLinks(payload.links);

  const source = SOURCE_FIELDS.map((f) => ({
    label: t[f.label],
    // A message id is an opaque handle; a proportional face makes it unreadable.
    mono: f.key === "email_id",
    value: localiseIfTimestamp(asText(payload[f.key]), lang),
  })).filter((row) => row.value.length > 0);

  /*
    The important half of this component. The bug it exists to fix was a renderer
    that knew one key while the box was writing seven and said nothing about the
    other six — knowing seven is the same bug one release later. So anything not
    rendered above is rendered here under its raw key: an unlabelled `cc_count 4`
    is worth more to the reader than a field nobody can see.

    Key names are passed through from mail too, so they are capped in length.
    Values are only wrapped, never truncated — cutting a value would hide the very
    thing this block exists to reveal.
  */
  const extras = Object.entries(payload)
    .filter(([key]) => !LABELLED_KEYS.has(key))
    .map(([key, value]) => ({
      key: key.length > MAX_KEY_CHARS ? `${key.slice(0, MAX_KEY_CHARS)}…` : key,
      value: localiseIfTimestamp(asText(value), lang),
    }))
    .filter((row) => row.value.length > 0);

  /*
    A flag code this build has no label for renders NOTHING as a flag. It has no
    dictionary entry, so the alternatives are a styled chip with no words — a
    warning that cannot say what it is warning about — or printing the code
    itself, which hands whoever influenced the analyser a byline in the place a
    warning belongs.

    It still arrived, though, so it lands here, under its own key, in the sweep
    that exists for exactly this: data the reader should see on the day it
    appears rather than on the day somebody reads the database.
  */
  if (flags.unknown.length > 0)
    extras.push({ key: "email_flags", value: asText(flags.unknown) });

  const hasFacts =
    flags.known.length > 0 || attachments.length > 0 || links.length > 0;

  if (!task && !detail && source.length === 0 && extras.length === 0 && !hasFacts)
    return <p className="text-xs text-muted-foreground">{t.payloadEmpty}</p>;

  return (
    <div className="space-y-3">
      {/* `task` carries what the person has to do. It gets the width to say it. */}
      {task ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
          {task}
        </p>
      ) : null}

      {/* Legacy shape: older rows put the whole item in one string. Shown, never required. */}
      {detail ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
          {detail}
        </p>
      ) : null}

      {source.length > 0 ? (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t.sourceEmail}
          </div>
          {/*
            A "View original email" control would go here. It cannot exist yet —
            there is no authenticated route that can fetch a message body — and a
            button that opens nothing is the theatre docs/ADDING-FEATURES.md
            forbids. Build the route first, then the control.
          */}
          <dl className="mt-1.5 space-y-1 text-xs">
            {source.map((row) => (
              <div key={row.label} className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd
                  className={cn(
                    "min-w-0 flex-1 text-foreground break-words",
                    row.mono && "font-mono break-all",
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {/*
        After the source email and before the raw sweep, because that is the
        reading order the decision needs: what the item is, who it came from,
        what the message itself contained, and only then the keys nobody has a
        label for.
      */}
      <EmailFacts
        flags={flags.known}
        attachments={attachments}
        links={links}
      />

      {extras.length > 0 ? (
        <div className="border-t border-border pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t.alsoInPayload}
          </div>
          <dl className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
            {extras.map((row) => (
              <div key={row.key} className="flex gap-2">
                <dt className="w-20 shrink-0 font-mono break-all">{row.key}</dt>
                <dd className="min-w-0 flex-1 break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

const MAX_KEY_CHARS = 48;

/**
 * jsonb holds anything, so a value here can be a number, a boolean, a list or a
 * nested object whatever its key implies. Everything becomes text; an empty result
 * means the field renders as nothing at all.
 */
function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // Circular structures throw. Showing nothing beats crashing the panel.
    return "";
  }
}

/*
  Only a machine timestamp is reformatted. "before the 5th" is what a person wrote,
  and `new Date` would either reject it or silently guess at it, so the sender's own
  words are the honest thing to render.
*/
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function localiseIfTimestamp(value: string, lang: Lang): string {
  if (!ISO_TIMESTAMP.test(value)) return value;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;

  // A date with no time is read as UTC midnight, so rendering it locally turns
  // the 11th into the 10th for anyone west of Greenwich. Read it back in UTC.
  const dateOnly = value.length === 10;
  return at.toLocaleString(lang === "en" ? "en-GB" : "zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : { hour: "2-digit", minute: "2-digit" }),
  });
}
