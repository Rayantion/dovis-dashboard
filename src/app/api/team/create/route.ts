import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/** Readable, unambiguous. No l/1/I/O/0 — this gets read aloud or written down. */
function makeTempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Owner-only. Creates the auth user and the profile together, which is why it
 * needs service_role: a browser cannot mint an `auth.users` row, and `profiles`
 * has no client INSERT policy precisely so that it cannot.
 *
 * New accounts are always created read-only (`can_modify: false`). Granting that
 * is a separate, warned action on the Team page — never a side effect of adding
 * someone.
 */
export async function POST(req: Request) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json({ error: "Only the owner can add accounts." }, { status: 403 });

  let body: { email?: string; username?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const username = body.username?.trim().toLowerCase();
  const displayName = body.displayName?.trim() || null;

  if (!email || !email.includes("@"))
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  if (!username || !/^[a-z0-9_.-]{3,32}$/.test(username))
    return NextResponse.json(
      { error: "Username: 3-32 characters, letters, numbers, . _ - only." },
      { status: 400 },
    );

  const admin = createAdmin();
  const tempPassword = makeTempPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true, // The owner hands the password over directly.
  });

  if (createError || !created.user)
    return NextResponse.json(
      { error: createError?.message ?? "Could not create the account." },
      { status: 400 },
    );

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({
      id: created.user.id,
      email,
      username,
      display_name: displayName,
      role: "admin",
      status: "active",
      can_modify: false,
      must_change_password: true,
    })
    .select()
    .single();

  if (profileError) {
    // Do not leave an auth user with no profile behind — it would be able to sign
    // in and land nowhere, and the username would look taken while being unusable.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ profile, tempPassword });
}
