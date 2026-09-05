import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";
import { permissionsFor } from "@/lib/types";

/**
 * The ONLY route by which a drafted email body reaches a browser.
 *
 * `todo_payloads` has RLS enabled and no client policy, and is deliberately absent
 * from the realtime publication, so this handler plus service_role is the entire
 * surface. The two checks below are therefore not decoration — together they are
 * the access control for every draft Dovis has ever written.
 *
 * Being signed in is not enough, and used to be. A draft is the owner's mail
 * rewritten in the owner's voice, so reading one is a much wider permission than
 * seeing that an item exists — the queue shows a subject line, this shows what
 * would go out under their name. `can_modify` is exactly the switch the owner
 * already turns on to let someone review proposals, behind a warning that names
 * this consequence, so it is the right gate rather than a new one.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  /*
    Derived server-side from the profile row, never from anything the caller sent.
    `requireProfile` establishes who is asking; this establishes what they may read.
  */
  if (!permissionsFor(auth.profile).canModify)
    return NextResponse.json(
      { error: "Your account can see the queue but not the draft bodies." },
      { status: 403 },
    );

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
