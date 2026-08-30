import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase/server";

/**
 * Username -> email, so people can sign in with either.
 *
 * This endpoint is necessarily unauthenticated: it runs BEFORE sign-in. It uses
 * service_role because a signed-out browser cannot read `profiles`.
 *
 * TRADEOFF, stated rather than hidden: this confirms whether a username exists,
 * which is a user-enumeration vector. It is accepted here because the dashboard
 * is single-tenant and sits behind a Cloudflare Tunnel, so reaching this endpoint
 * already means passing the tunnel's access control. If you ever expose the
 * dashboard directly to the internet, replace this with a full server-side
 * sign-in that takes the password in the same request and returns one generic
 * error for every failure.
 */
export async function POST(req: Request) {
  let username: unknown;
  try {
    ({ username } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (typeof username !== "string" || !/^[a-z0-9_.-]{3,32}$/.test(username.toLowerCase()))
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const admin = createAdmin();
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("username", username.toLowerCase())
    .maybeSingle();

  if (!data) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  return NextResponse.json({ email: data.email });
}
