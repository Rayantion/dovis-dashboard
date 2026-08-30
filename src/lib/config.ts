/**
 * Demo mode is what the public showcase deployment runs on.
 *
 * It is ON whenever Supabase credentials are absent. That is deliberate: a fresh
 * clone with no .env.local starts up showing a complete, working dashboard on
 * fixtures, so you can look at the design before you own a database. The moment
 * real credentials exist, the same components read real rows.
 *
 * Demo mode never touches a network. Every mutation lives in browser state and
 * resets on reload.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isDemoMode = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Shown on the login screen in demo mode so the page is self-explaining. */
export const DEMO_ACCOUNTS = [
  {
    label: "Owner",
    username: "owner",
    password: "demo",
    note: "Full control, team management, danger zone",
  },
  {
    label: "Assistant (read-only)",
    username: "assistant",
    password: "demo",
    note: "Sees everything, decides nothing",
  },
] as const;
