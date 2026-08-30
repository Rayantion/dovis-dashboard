import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * Danger zone. Owner-only. Removes every row in every state, including items
 * still waiting on a decision and items the executor may be mid-way through.
 */
export async function POST() {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json({ error: "Only the owner can delete." }, { status: 403 });

  const admin = createAdmin();
  // Supabase requires a filter on delete; this one matches every row.
  const { error } = await admin
    .from("todos")
    .delete()
    .not("id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
