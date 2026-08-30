import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";

/**
 * The ONLY route by which a drafted email body reaches a browser.
 *
 * `todo_payloads` has RLS enabled and no client policy, and is deliberately absent
 * from the realtime publication, so this handler plus service_role is the entire
 * surface. The session check above it is therefore not decoration — it is the
 * access control for every draft Dovis has ever written.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  const admin = createAdmin();
  const { data, error } = await admin
    .from("todo_payloads")
    .select("*")
    .eq("todo_id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(data, {
    // Draft bodies must never sit in a shared or disk cache.
    headers: { "cache-control": "no-store, private" },
  });
}
