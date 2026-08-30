import { NextResponse } from "next/server";
import { createAdmin, isFailure, requireProfile } from "@/lib/supabase/server";
import { permissionsFor } from "@/lib/types";

/**
 * Confirm / modify / reject.
 *
 * Deliberately does NOT perform the action. Confirming only moves the row to
 * `confirmed`; the executor cron on the box claims it by setting `executing`,
 * acts, and then marks it `done`. If this route wrote a Gmail draft itself, the
 * dashboard would become a second executor and two of them would race.
 */
export async function POST(req: Request) {
  const auth = await requireProfile();
  if (isFailure(auth))
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!permissionsFor(auth.profile).canModify)
    return NextResponse.json(
      { error: "Your account can view the queue but not act on it." },
      { status: 403 },
    );

  let body: { todoId?: string; action?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { todoId, action, note } = body;
  if (!todoId || !action || !["confirm", "modify", "reject"].includes(action))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const admin = createAdmin();

  // Only a proposal can be decided. Re-confirming something already executing
  // would hand the executor a second claim on a row it is mid-way through.
  const { data: current } = await admin
    .from("todos")
    .select("status")
    .eq("id", todoId)
    .maybeSingle();

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (current.status !== "proposed")
    return NextResponse.json(
      { error: `That item is already ${current.status}.` },
      { status: 409 },
    );

  const patch =
    action === "confirm"
      ? { status: "confirmed", confirmed_at: new Date().toISOString() }
      : action === "modify"
        ? { status: "modifying" }
        : { status: "rejected" };

  const { error } = await admin.from("todos").update(patch).eq("id", todoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The note goes on the payload, never the queue row — the queue row is
  // browser-readable and a modify note can quote the draft it is correcting.
  if (note && action !== "confirm") {
    await admin
      .from("todo_payloads")
      .update(
        action === "modify" ? { modify_note: note } : { reject_reason: note },
      )
      .eq("todo_id", todoId);
  }

  return NextResponse.json({ ok: true });
}
