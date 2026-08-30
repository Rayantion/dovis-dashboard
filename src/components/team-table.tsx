"use client";

import * as React from "react";
import { UserPlus, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TeamTable() {
  const { t } = useI18n();
  const { profiles, session, createAdmin, updateAdmin, removeAdmin } = useDovis();

  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ email: "", username: "", displayName: "" });
  const [tempPassword, setTempPassword] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Ticking "allow modify" is the single most consequential switch in the product,
  // so it is confirmed rather than toggled.
  const [warnFor, setWarnFor] = React.useState<Profile | null>(null);
  const [removing, setRemoving] = React.useState<Profile | null>(null);

  async function submitNew() {
    if (!form.email.includes("@")) return toast.error("That email doesn't look right.");
    if (!/^[a-z0-9_.-]{3,32}$/.test(form.username.toLowerCase()))
      return toast.error("Username: 3-32 chars, letters, numbers, . _ - only.");

    setBusy(true);
    const res = await createAdmin({ ...form, username: form.username.toLowerCase() });
    setBusy(false);

    if ("error" in res) return toast.error(res.error);
    setTempPassword(res.tempPassword);
    setForm({ email: "", username: "", displayName: "" });
    setAdding(false);
  }

  async function confirmAllowModify() {
    if (!warnFor) return;
    const err = await updateAdmin(warnFor.id, { can_modify: true });
    setWarnFor(null);
    if (err) toast.error(err);
    else toast.success(`${warnFor.display_name ?? warnFor.username} can now act on the queue.`);
  }

  async function doRemove() {
    if (!removing) return;
    const err = await removeAdmin(removing.id);
    setRemoving(null);
    if (err) toast.error(err);
    else toast.success("Account removed.");
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg text-foreground">{t.team}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            An assistant can see everything and, unless you say otherwise, decide nothing.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5 shrink-0">
          <UserPlus className="size-3.5" />
          {t.addAdmin}
        </Button>
      </div>

      <div className="paper rounded-lg divide-y divide-border">
        {profiles.map((p) => {
          const isSelf = p.id === session?.profile.id;
          const isOwner = p.role === "owner";
          return (
            <div key={p.id} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {p.display_name ?? p.username}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                      isOwner
                        ? "border-primary/30 bg-primary/8 text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {isOwner ? t.owner : t.admin}
                  </span>
                  {p.status === "paused" ? (
                    <span className="rounded-full border border-status-failed/40 bg-status-failed/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-status-failed">
                      {t.paused}
                    </span>
                  ) : null}
                  {p.must_change_password ? (
                    <span className="rounded-full border border-status-executing/40 bg-status-executing/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-status-executing">
                      {t.tempPasswordIs}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {p.username} · {p.email}
                </div>
              </div>

              {!isOwner ? (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`mod-${p.id}`}
                      checked={p.can_modify}
                      onCheckedChange={(v) => {
                        if (v) setWarnFor(p);
                        else void updateAdmin(p.id, { can_modify: false });
                      }}
                    />
                    <Label htmlFor={`mod-${p.id}`} className="text-xs cursor-pointer">
                      {t.allowModify}
                    </Label>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      void updateAdmin(p.id, {
                        status: p.status === "active" ? "paused" : "active",
                      })
                    }
                  >
                    {p.status === "active" ? t.pause : t.resume}
                  </Button>

                  {!isSelf ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setRemoving(p)}
                    >
                      {t.remove}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Full control. Cannot be paused or removed.
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- add admin */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">{t.addAdmin}</DialogTitle>
            <DialogDescription>
              They will receive a temporary password and must change it the first time
              they sign in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">{t.displayName}</Label>
              <Input
                id="new-name"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email">{t.email}</Label>
              <Input
                id="new-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-username">{t.username}</Label>
              <Input
                id="new-username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="chia-hui"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t.cancel}
            </Button>
            <Button onClick={submitNew} disabled={busy}>
              {t.addAdmin}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------- temp password shown */}
      <Dialog open={tempPassword !== null} onOpenChange={() => setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">{t.tempPasswordIs}</DialogTitle>
            <DialogDescription>{t.tempPasswordCopy}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm select-all">
              {tempPassword}
            </code>
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(tempPassword ?? "");
                toast.success("Copied.");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This is shown once. If it is lost, remove the account and create it again.
          </p>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------- allow-modify warning gate */}
      <AlertDialog open={warnFor !== null} onOpenChange={(v) => !v && setWarnFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading flex items-center gap-2">
              <TriangleAlert className="size-4 text-status-executing" />
              {t.allowModifyWarningTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {t.allowModifyWarningBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAllowModify}>
              {t.enableAnyway}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -------------------------------------------------------- remove gate */}
      <AlertDialog open={removing !== null} onOpenChange={(v) => !v && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-destructive">
              {t.removeAdminTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>{t.removeAdminBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={doRemove}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
