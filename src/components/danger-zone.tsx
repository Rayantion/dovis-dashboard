"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";

/*
  Owner-only. An assistant never renders this, and the server routes behind it
  check the role again — the UI hiding a button is not a permission.

  Everything here is irreversible, so each action is gated behind typing a word.
  A confirm dialog you can dismiss with a reflexive Enter is not a gate.
*/

const CONFIRM_WORD = "DELETE";

export function DangerZone() {
  const { t } = useI18n();
  const { perms, clearCompleted, deleteAllTodos } = useDovis();
  const [action, setAction] = React.useState<"clear" | "all" | null>(null);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (!perms.canDelete) return null;

  async function run() {
    setBusy(true);
    const err = action === "clear" ? await clearCompleted() : await deleteAllTodos();
    setBusy(false);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success(action === "clear" ? "Completed items removed." : "Queue deleted.");
    setAction(null);
    setTyped("");
  }

  return (
    <section className="rounded-lg border border-destructive/30 bg-destructive/[0.03] overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-destructive/20">
        <ShieldAlert className="size-4 text-destructive" />
        <h2 className="font-heading text-sm text-destructive">{t.dangerZone}</h2>
      </header>

      <p className="px-4 pt-3 text-xs text-muted-foreground">{t.dangerZoneHint}</p>

      <div className="p-4 space-y-3">
        <Row
          title={t.clearCompleted}
          hint={t.clearCompletedHint}
          cta={t.clearCta}
          onClick={() => setAction("clear")}
        />
        <Row
          title={t.deleteAll}
          hint={t.deleteAllHint}
          cta={t.deleteCta}
          onClick={() => setAction("all")}
        />
      </div>

      <Dialog
        open={action !== null}
        onOpenChange={(v) => {
          if (!v) {
            setAction(null);
            setTyped("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading text-destructive">
              {action === "clear" ? t.clearCompleted : t.deleteAll}
            </DialogTitle>
            <DialogDescription>
              {action === "clear" ? t.clearCompletedHint : t.deleteAllHint}
            </DialogDescription>
          </DialogHeader>

          <label className="text-xs text-muted-foreground">
            {t.typeToConfirm} <code className="font-mono text-foreground">{CONFIRM_WORD}</code>{" "}
            {t.toConfirm}
          </label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAction(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || typed !== CONFIRM_WORD}
              onClick={run}
            >
              {action === "clear" ? t.clearCompleted : t.deleteAll}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/*
  `cta` is passed explicitly rather than derived from the title. Taking the first
  word of the title worked in English and produced the entire sentence in Chinese,
  because 清除已完成項目 has no spaces to split on.
*/
function Row({
  title,
  hint,
  cta,
  onClick,
}: {
  title: string;
  hint: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-card p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onClick}
      >
        {cta}
      </Button>
    </div>
  );
}
