import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness plus, more importantly, WHICH MODE this deployment is in.
 *
 * The failure this exists to prevent: a fresh clone with no `.env.local` starts up
 * and serves a complete, convincing dashboard on fixtures. It looks entirely
 * healthy — `/login` returns 200, the queue renders, sign-in works — while showing
 * data that does not exist. An operator or an agent checking only that the service
 * is up would report a working install and be wrong.
 *
 * So `demo` is the field that matters on a real box, and it must be false.
 *
 * Returns booleans only: never a URL, never a key, never a token. Safe to leave
 * unauthenticated, which it must be so a health check can reach it before anyone
 * has signed in.
 */
export async function GET() {
  const supabase = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const google = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI,
  );

  /*
    Supabase configured but no service_role is the nastiest half-state: sign-in and
    the queue work, so it looks fine, but expanding any item fails because reading
    `todo_payloads` needs the key that bypasses RLS. Called out rather than left for
    someone to discover on the first draft they try to open.
  */
  const misconfigured = supabase && !serviceRole;

  return NextResponse.json(
    {
      ok: !misconfigured,
      demo: !supabase,
      supabase,
      serviceRole,
      google,
      ...(misconfigured
        ? {
            error:
              "SUPABASE_SERVICE_ROLE_KEY is missing. Sign-in and the queue will work, but no draft can be opened.",
          }
        : {}),
    },
    {
      status: misconfigured ? 500 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
