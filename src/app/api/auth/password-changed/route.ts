import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * Clears `must_change_password` after the user actually set a new one.
 *
 * It is a separate call rather than something the client writes, because a client
 * that could set this flag directly could also clear it WITHOUT changing the
 * password — which is the whole thing the flag exists to prevent.
 */
export async function POST() {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdmin();
  const { error } = await admin
    .from("profiles")
    .update({ must_change_password: false, last_sign_in_at: new Date().toISOString() })
    .eq("id", auth.profile.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
