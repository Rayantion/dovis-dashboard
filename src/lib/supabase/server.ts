import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

/**
 * Request-scoped client that reads the session from cookies. Use this to find out
 * WHO is calling. Never use it to bypass a permission — it is bound by RLS.
 */
export async function createRouteClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render; middleware refreshes instead.
          }
        },
      },
    },
  );
}

/**
 * service_role client. BYPASSES RLS ENTIRELY.
 *
 * Only for the two jobs the browser must never do: reading `todo_payloads`, and
 * creating or deleting accounts. Every caller must establish the session and check
 * the role FIRST — see requireProfile below. This key must never be exposed to the
 * client, so it has no NEXT_PUBLIC_ prefix and this module is server-only.
 */
export function createAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AuthFailure = { error: string; status: 401 | 403 };

/**
 * The gate every mutating route goes through. Resolves the caller's profile and
 * refuses paused accounts, whose JWT stays valid until it expires.
 */
export async function requireProfile(): Promise<
  { profile: Profile } | AuthFailure
> {
  const supabase = await createRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", status: 401 };

  const admin = createAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !data) return { error: "No profile for this user", status: 403 };
  const profile = data as Profile;
  if (profile.status !== "active")
    return { error: "This account is paused", status: 403 };

  return { profile };
}

export function isFailure(r: { profile: Profile } | AuthFailure): r is AuthFailure {
  return "error" in r;
}
