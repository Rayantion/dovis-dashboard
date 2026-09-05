import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";
import type { Lang } from "@/lib/i18n";

/**
 * Sets the caller's own reading language.
 *
 * This exists rather than a direct client write because `profiles` has no
 * self-update policy — the only UPDATE policy is `owner updates`, gated on
 * `dovis_is_owner()`. An assistant therefore cannot write their own row at all,
 * and an owner could write *any* row including `role`. Routing both through
 * service_role after a session check keeps one narrow door open instead of
 * widening RLS for a preference.
 *
 * The account is taken from the session and the value from a two-item union.
 * Neither is read from the request body: a body carrying `{ id, lang }` would
 * let any signed-in account rewrite anyone's settings, and the id is the half
 * that matters.
 */

const ALLOWED: readonly Lang[] = ["en", "zh-TW"];

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (ALLOWED as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const lang = (body as { lang?: unknown } | null)?.lang;
  if (!isLang(lang))
    // Named rather than echoed. Reflecting the rejected value would put an
    // attacker-chosen string into the response and, from there, into a log.
    return NextResponse.json(
      { error: "Language must be one of: en, zh-TW." },
      { status: 400 },
    );

  const admin = createAdmin();
  const { error } = await admin
    .from("profiles")
    .update({ lang })
    .eq("id", auth.profile.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lang });
}
