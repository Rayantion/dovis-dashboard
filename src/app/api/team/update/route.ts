import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * Owner-only. The two switches the owner controls: `can_modify` and `status`.
 *
 * `role` is deliberately NOT accepted. Promoting someone to owner is not a thing
 * this product does through a web form — there is one principal, and the account
 * is created in the Supabase dashboard.
 */
export async function POST(req: Request) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json({ error: "Only the owner can do that." }, { status: 403 });

  let body: { id?: string; can_modify?: boolean; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const admin = createAdmin();

  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", body.id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });
  if (target.role === "owner")
    return NextResponse.json(
      { error: "The owner account cannot be paused or restricted." },
      { status: 403 },
    );

  const patch: Record<string, unknown> = {};
  if (typeof body.can_modify === "boolean") patch.can_modify = body.can_modify;
  if (body.status === "active" || body.status === "paused") patch.status = body.status;

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { error } = await admin.from("profiles").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
