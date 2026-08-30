import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * Danger zone. Owner-only, never granted by `can_modify`.
 *
 * Deleting done and rejected rows also deletes their payloads through the ON
 * DELETE CASCADE — including every `payload_proposed` / `payload_current` pair,
 * which is the labelled correction data the agent learns from. That is why the
 * UI wording says Dovis stops learning from it rather than "clears old items".
 */
export async function POST() {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.profile.role !== "owner")
    return NextResponse.json({ error: "Only the owner can delete." }, { status: 403 });

  const admin = createAdmin();
  const { error } = await admin
    .from("todos")
    .delete()
    .in("status", ["done", "rejected"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
