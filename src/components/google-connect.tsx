"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Mail, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";

interface Status {
  configured: boolean;
  account?: string | null;
  gauth?: boolean;
  accounts?: boolean;
  token?: boolean;
  credentialsDir?: string;
  tokenFilePattern?: string;
}

/**
 * Owner-only. Replaces the SSH-and-paste-a-JSON dance with one button.
 *
 * Absent from the demo deployment on purpose: the flow writes credentials to the
 * box's filesystem, which only exists where the dashboard and the agent are the
 * same machine.
 */
export function GoogleConnect() {
  const { t } = useI18n();
  const { perms, demo } = useDovis();
  const params = useSearchParams();
  const [status, setStatus] = React.useState<Status | null>(null);

  const result = params.get("google");
  const reason = params.get("reason");

  React.useEffect(() => {
    if (demo || !perms.canManageTeam) return;
    fetch("/api/google/status")
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then(setStatus)
      .catch(() => setStatus({ configured: false }));
  }, [demo, perms.canManageTeam, result]);

  if (!perms.canManageTeam) return null;

  if (demo) {
    return (
      <Card>
        <p className="text-xs text-muted-foreground">{t.googleUnavailable}</p>
      </Card>
    );
  }

  if (!status) return null;

  if (!status.configured) {
    return (
      <Card>
        <p className="text-xs text-muted-foreground">{t.googleUnavailable}</p>
      </Card>
    );
  }

  // `token` is the fact that matters. OAuth completing and the agent being able to
  // read mail are different things, because the filename the MCP server looks for
  // is configurable — so a green tick here means the file is on disk, not that a
  // flow once returned 200.
  const connected = Boolean(status.account && status.token);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" />
            <h3 className="font-heading text-sm text-foreground">{t.googleTitle}</h3>
            {connected ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                <CircleCheck className="size-3" />
                {t.googleConnected}
              </span>
            ) : null}
          </div>

          <p className="mt-1.5 text-xs text-muted-foreground">
            {connected ? status.account : t.googleNotConnected}
          </p>

          {status.account && !status.token ? (
            <p className="mt-2 flex gap-1.5 text-xs text-status-executing">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Authorised as {status.account}, but no token file was found at{" "}
                <code className="font-mono">{status.tokenFilePattern}</code> in{" "}
                <code className="font-mono">{status.credentialsDir}</code>. Run the MCP
                server&apos;s own auth once, check the filename it writes, and set
                GOOGLE_TOKEN_FILE_PATTERN to match.
              </span>
            </p>
          ) : null}
        </div>

        {/*
          A full navigation, not fetch(): the route answers with a 302 to Google's
          consent screen, which the browser must follow at the top level. An XHR
          would follow the redirect invisibly and hand back Google's HTML.
        */}
        <Button
          size="sm"
          variant={connected ? "outline" : "default"}
          className="shrink-0"
          onClick={() => {
            window.location.href = "/api/google/connect";
          }}
        >
          {connected ? t.googleReconnect : t.googleConnect}
        </Button>
      </div>

      {result === "error" ? (
        <p className="mt-3 text-xs text-destructive">{reason ?? "Connection failed."}</p>
      ) : null}
      {result === "cancelled" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Cancelled at the Google screen. Nothing changed.
        </p>
      ) : null}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="paper rounded-lg p-4">{children}</section>;
}
