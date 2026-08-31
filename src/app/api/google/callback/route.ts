import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isFailure, requireProfile } from "@/lib/supabase/server";
import {
  exchangeCode,
  fetchEmail,
  googleConfig,
  STATE_COOKIE,
  tokenFilePath,
} from "@/lib/google";

export const runtime = "nodejs";

function backTo(req: Request, params: Record<string, string>) {
  const url = new URL("/team", req.url);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return NextResponse.redirect(url);
}

/**
 * Google redirects here with the authorisation code.
 *
 * Everything written below lands on THIS machine, in the directory the MCP server
 * reads. No credential is stored in Supabase and none leaves the box.
 */
export async function GET(req: Request) {
  const auth = await requireProfile();
  if (isFailure(auth)) return backTo(req, { google: "error", reason: auth.error });
  if (auth.profile.role !== "owner")
    return backTo(req, { google: "error", reason: "Owner only" });

  const cfg = googleConfig();
  if (!cfg) return backTo(req, { google: "error", reason: "Not configured" });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  if (denied) return backTo(req, { google: "cancelled" });
  if (!code || !state) return backTo(req, { google: "error", reason: "Bad callback" });

  // Constant-time compare, and both sides must be the same byte length or
  // timingSafeEqual throws rather than returning false.
  const expected = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  const a = Buffer.from(state);
  const b = Buffer.from(expected ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return backTo(req, { google: "error", reason: "State mismatch" });

  try {
    const tokens = await exchangeCode(cfg, code);

    // A grant with no refresh token is useless here: it dies within the hour and
    // the agent has no way to renew it. Better to fail loudly now than to report
    // success and break at 3am.
    if (!tokens.refresh_token)
      return backTo(req, {
        google: "error",
        reason:
          "Google returned no refresh token. Revoke this app at myaccount.google.com/permissions and connect again.",
      });

    const email = await fetchEmail(tokens.access_token);

    await mkdir(cfg.credentialsDir, { recursive: true });

    // .gauth.json — the client credentials the MCP server reads.
    await writeFile(
      cfg.gauthFile,
      JSON.stringify(
        {
          web: {
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            redirect_uris: [cfg.redirectUri],
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    // .accounts.json — which mailbox this box acts for.
    await writeFile(
      cfg.accountsFile,
      JSON.stringify(
        { accounts: [{ email, account_type: "personal", extra_info: "" }] },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    // The token itself. 0600 — it is the key to the principal's mailbox.
    await writeFile(
      tokenFilePath(cfg, email),
      JSON.stringify(
        {
          token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_uri: "https://oauth2.googleapis.com/token",
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          scopes: tokens.scope.split(" "),
          expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    return backTo(req, { google: "connected", account: email });
  } catch (err) {
    return backTo(req, {
      google: "error",
      reason: err instanceof Error ? err.message : "Unknown failure",
    });
  }
}
