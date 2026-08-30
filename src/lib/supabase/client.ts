"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isDemoMode } from "@/lib/config";

/**
 * Browser client. Carries the signed-in user's JWT, which is what makes the
 * `TO authenticated` policies in schema.sql resolve — and what lets Realtime
 * stream rows the anon key alone can no longer read.
 *
 * Returns null in demo mode. Callers must handle that rather than assume a client.
 */
export function createClient() {
  if (isDemoMode) return null;
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
