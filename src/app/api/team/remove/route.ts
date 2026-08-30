import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * Owner-only, and irreversible. Deleting the auth user cascades to the profile
 * via the foreign key, so there is no orphan to clean up.
 *
 * An assistant reaching this route is refused regardless of `can_modify` — that
 * permission covers the queue and never account deletion.
 */
export async function POST(req: Request) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json({ error: "Only the owner can remove accounts." }, { status: 403 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (body.id === auth.profile.id)
    return NextResponse.json(
      { error: "You cannot remove your own account." },
      { status: 400 },
    );

  const admin = createAdmin();

  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", body.id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });
  if (target.role === "owner")
    return NextResponse.json({ error: "The owner cannot be removed." }, { status: 403 });

  const { error } = await admin.auth.admin.deleteUser(body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
