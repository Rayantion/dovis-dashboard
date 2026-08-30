"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDovis } from "@/lib/dovis-provider";
import { useI18n } from "@/lib/i18n";
import { DEMO_ACCOUNTS } from "@/lib/config";

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const { signIn, session, ready, demo } = useDovis();
  const router = useRouter();

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (ready && session) {
      router.replace(session.profile.must_change_password ? "/set-password" : "/");
    }
  }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(identifier, password);
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
        <button
          onClick={() => setLang(lang === "en" ? "zh-TW" : "en")}
          className="mb-8 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {lang === "en" ? "繁體中文" : "English"}
        </button>

        <h1 className="font-heading text-4xl text-primary tracking-tight">{t.brand}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t.tagline}</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="identifier">{t.usernameOrEmail}</Label>
            <Input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t.password}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {t.signIn}
          </Button>
        </form>

        {demo ? (
          <div className="mt-8 rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
              Demo accounts
            </p>
            <div className="space-y-2.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  onClick={() => {
                    setIdentifier(a.username);
                    setPassword(a.password);
                  }}
                  className="w-full text-left rounded-md border border-border bg-card px-3 py-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{a.label}</span>
                    <code className="font-mono text-[11px] text-muted-foreground">
                      {a.username} / {a.password}
                    </code>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{a.note}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
