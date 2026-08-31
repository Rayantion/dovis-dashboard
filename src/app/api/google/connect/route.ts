import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { isFailure, requireProfile } from "@/lib/supabase/server";
import { buildAuthUrl, googleConfig, STATE_COOKIE } from "@/lib/google";

// Writes to the box's filesystem downstream, so this cannot run on the edge.
export const runtime = "nodejs";

/**
 * Starts the Google consent flow. Owner-only.
 *
 * The `state` value is not decoration. Without it, anyone can hand the principal a
 * crafted callback URL and attach THEIR OWN Google account to this Dovis — after
 * which the assistant reads an attacker's mailbox and drafts replies from it. The
 * cookie is SameSite=Lax specifically so it survives Google's redirect back;
 * Strict would drop it and every callback would fail as a forgery.
 */
export async function GET() {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json(
      { error: "Only the owner can connect a Google account." },
      { status: 403 },
    );

  const cfg = googleConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "Google OAuth is not configured on this deployment." },
      { status: 501 },
    );

  const state = randomBytes(32).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(cfg, state));

  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return res;
}
