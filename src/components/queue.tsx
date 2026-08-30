"use client";

import * as React from "react";
import { ChevronDown, Mail, Hand, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import { useI18n } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";
import type {
  DraftEmailPayload,
  ManualPayload,
  Todo,
  TodoPayload,
  TodoStatus,
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
    if (next && !payload) {
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

          {open ? (
            <div className="mt-3 rounded-md border border-border bg-muted/40 p-3.5">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ) : payload ? (
                <PayloadView payload={payload} actionType={todo.action_type} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Could not load the contents.
                </p>
              )}
            </div>
          ) : null}

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
            className={cn("size-4 transition-transform", open && "rotate-180")}
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

  if (actionType === "manual") {
    const c = payload.payload_current as ManualPayload;
    return (
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
        {c.detail}
      </p>
    );
  }

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
