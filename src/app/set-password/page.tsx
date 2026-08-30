"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDovis } from "@/lib/dovis-provider";
import { useI18n } from "@/lib/i18n";

/**
 * The only page a temporary password can reach. The Gate sends every other route
 * here while `must_change_password` is true, so an account cannot be used on its
 * issued password beyond the moment it is replaced.
 */
export default function SetPasswordPage() {
  const { t } = useI18n();
  const { session, ready, changePassword } = useDovis();
  const router = useRouter();

  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await changePassword(pw);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.replace("/");
  }

  return (
    <main className="flex-1 grid place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 text-primary">
          <KeyRound className="size-4" />
          <h1 className="font-heading text-2xl tracking-tight">{t.setPassword}</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {t.tempPasswordNotice}
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw">{t.newPassword}</Label>
            <Input
              id="pw"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pw2">{t.confirmPassword}</Label>
            <Input
              id="pw2"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {t.setPassword}
          </Button>
        </form>
      </div>
    </main>
  );
}
