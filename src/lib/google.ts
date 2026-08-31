import path from "node:path";

/*
  Browser-side OAuth for Gmail and Calendar.

  WHY THIS EXISTS: the alternative is the operator SSHing into the box, downloading
  a client JSON, scp-ing it across, running a CLI, copying a URL out to a browser and
  the code back in. This replaces all of that with the principal clicking one button.

  WHY IT IS SAFE TO DO IT HERE: on a client box the dashboard and the agent are the
  SAME MACHINE. The callback writes credentials straight to the directory the MCP
  server already reads, so the refresh token never enters the database and never
  crosses a network. That is the whole reason this is worth building rather than a
  reason to be nervous about it.

  It does NOT remove the Google Cloud step — a web flow still needs a client ID and
  secret — and it does NOT change the 7-day refresh-token expiry, which is governed
  by the OAuth app's user type. Create the client as INTERNAL inside the principal's
  Workspace org and neither the expiry nor verification applies.
*/

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT =
  "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * The smallest set that still lets Dovis do its job.
 *
 * `gmail.modify` covers reading mail and creating drafts. Gmail has NO draft-only
 * scope — `gmail.compose` and `gmail.modify` both permit sending at the API level —
 * so "Dovis cannot send" is enforced where it always was: `gmail_reply` is off the
 * tool allowlist and GMAIL_ALLOW_SENDING is unset. Do not add `gmail.send` or
 * `https://mail.google.com/`; neither buys anything and both widen the grant.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export const STATE_COOKIE = "dovis_google_state";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  credentialsDir: string;
  accountsFile: string;
  gauthFile: string;
  /** `{email}` is substituted. See the warning in googleConfig() below. */
  tokenFilePattern: string;
}

/**
 * Returns null when Google OAuth is not configured, which is the normal state for
 * the demo deployment. Callers must treat null as "this feature is off", not as an
 * error.
 */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;

  const credentialsDir =
    process.env.GOOGLE_CREDENTIALS_DIR ?? "/home/jarvis/mcp-google-workspace";

  return {
    clientId,
    clientSecret,
    redirectUri,
    credentialsDir,
    accountsFile:
      process.env.GOOGLE_ACCOUNTS_FILE ?? path.join(credentialsDir, ".accounts.json"),
    gauthFile:
      process.env.GOOGLE_GAUTH_FILE ?? path.join(credentialsDir, ".gauth.json"),
    /*
      VERIFY THIS BEFORE TRUSTING IT.

      The MCP server decides the filename it looks for inside --credentials-dir.
      The default below follows the convention its upstream uses, but it has NOT
      been confirmed against a running box, and a wrong name fails in the worst
      possible way: OAuth succeeds, the dashboard reports connected, and the agent
      still cannot read mail.

      To confirm: run the server's own CLI auth once on the box, then
      `ls -a` the credentials dir and copy the exact filename it produced into
      GOOGLE_TOKEN_FILE_PATTERN.
    */
    tokenFilePattern:
      process.env.GOOGLE_TOKEN_FILE_PATTERN ?? ".oauth2.{email}.json",
  };
}

export function tokenFilePath(cfg: GoogleConfig, email: string) {
  return path.join(cfg.credentialsDir, cfg.tokenFilePattern.replace("{email}", email));
}

export function buildAuthUrl(cfg: GoogleConfig, state: string) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    // Both are load-bearing. Without offline access Google returns no refresh token
    // at all; without forcing the consent prompt it returns one only on the FIRST
    // ever consent for this client/user pair, so a re-authorisation appears to work
    // and then dies when the access token expires an hour later.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function fetchEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not read the Google account address");
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("Google returned no email address");
  return json.email.toLowerCase();
}
