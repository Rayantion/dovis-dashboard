import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { isFailure, requireProfile } from "@/lib/supabase/server";
import { googleConfig, tokenFilePath } from "@/lib/google";

export const runtime = "nodejs";

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reports what is actually on disk rather than whether a flow once succeeded.
 *
 * That distinction is the point: the filename the MCP server looks for is
 * configurable, so "OAuth completed" and "the agent can read mail" are different
 * facts. This endpoint reports the second one, and never returns a token value.
 */
export async function GET() {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.profile.role !== "owner")
    return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const cfg = googleConfig();
  if (!cfg) return NextResponse.json({ configured: false });

  let account: string | null = null;
  try {
    const raw = await readFile(cfg.accountsFile, "utf8");
    account = JSON.parse(raw)?.accounts?.[0]?.email ?? null;
  } catch {
    account = null;
  }

  return NextResponse.json({
    configured: true,
    account,
    gauth: await exists(cfg.gauthFile),
    accounts: await exists(cfg.accountsFile),
    token: account ? await exists(tokenFilePath(cfg, account)) : false,
    credentialsDir: cfg.credentialsDir,
    tokenFilePattern: cfg.tokenFilePattern,
  });
}
