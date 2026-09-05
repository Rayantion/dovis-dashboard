"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useDovis } from "@/lib/dovis-provider";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/*
  Two ways back to the truth, for one failure that is otherwise invisible.

  Realtime carries the queue, but Postgres Changes gives no delivery guarantee —
  a sleeping laptop or a dropped tunnel loses every event in the gap, and the
  socket reconnects looking healthy. Nothing in the UI used to say so, and there
  was no way to recover short of reloading the page.

  So: a button that is always on screen, and a banner that appears only when the
  provider is holding changes back. The banner is not a notification of new work
  — it is the queue admitting it is not current.
*/

export function RefreshButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const { refresh, refreshing, connection, demo } = useDovis();

  const degraded = connection === "stale" || connection === "offline";
  const label = demo
    ? t.refreshDemo
    : connection === "stale"
      ? t.connectionStale
      : connection === "offline"
        ? t.connectionOffline
        : refreshing
          ? t.refreshing
          : t.refresh;

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={refreshing}
      aria-label={label}
      title={label}
      className={cn(
        "squircle inline-flex h-8 items-center gap-1.5 border bg-card px-2.5 text-xs font-medium transition-colors",
        "disabled:opacity-60",
        degraded
          ? "border-primary/40 text-primary hover:bg-primary/5"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/25",
        className,
      )}
    >
      {degraded ? (
        <WifiOff className="size-3.5" />
      ) : (
        <RefreshCw
          className={cn("size-3.5", refreshing && "animate-spin motion-reduce:animate-none")}
        />
      )}
      {/*
        The word stays "Refresh" in every state. What the button DOES never
        changes; only how badly you need it, which the icon and the accent carry.
        The connection wording lives in the title and aria-label, where it can be
        a full sentence instead of a word that has to be guessed at.
      */}
      <span className="hidden sm:inline">{t.refresh}</span>
    </button>
  );
}

/**
 * Sits in the sticky header stack rather than floating over the page, so it can
 * never cover the row someone is about to act on — the exact mistake it exists
 * to prevent.
 */
export function StaleBanner() {
  const { t } = useI18n();
  const { pendingCount, refresh, refreshing, connection } = useDovis();

  const degraded = connection === "stale" || connection === "offline";
  if (pendingCount === 0 && !degraded) return null;

  const message =
    pendingCount === 0
      ? connection === "stale"
        ? t.connectionStale
        : t.connectionOffline
      : pendingCount === 1
        ? t.newItemsOne
        : t.newItems.replace("{n}", String(pendingCount));

  return (
    <div
      role="status"
      /*
        Mounts only when there is something to admit, so the fade marks the
        moment the queue fell behind — and it is one pass. A banner that kept
        moving would be an alarm the reader cannot switch off, and this is not
        an alarm: it is a fact about the connection, and it stops being news the
        instant it has been read.
      */
      className="animate-appear border-t border-primary/20 bg-primary/8 text-primary"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-5 py-2 flex items-center gap-3">
        <span className="text-xs font-medium">{message}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="ml-auto squircle inline-flex h-7 shrink-0 items-center gap-1.5 border border-primary/30 bg-card px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          <RefreshCw
            className={cn("size-3.5", refreshing && "animate-spin motion-reduce:animate-none")}
          />
          {pendingCount > 0 ? t.showThem : t.refresh}
        </button>
      </div>
    </div>
  );
}
