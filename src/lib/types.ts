/*
  These types mirror supabase/schema.sql exactly. If you change one, change both —
  the CHECK constraints in the database are the real enforcement, and a type that
  drifts from them will let you write code the database then rejects at runtime.
*/

// Type-only, so it is erased at compile time and this module stays free of any
// runtime import — `i18n.ts` is a client module and this file is read by server
// routes too. One definition of the pair, matching one CHECK constraint.
import type { Lang } from "@/lib/i18n";

/** The queue lifecycle. `executing` is a claim the executor sets BEFORE acting. */
export type TodoStatus =
  | "proposed"
  | "modifying"
  | "confirmed"
  | "executing"
  | "done"
  | "rejected"
  | "failed";

/**
 * What Dovis is permitted to actually do.
 *
 * There is no `send_email` and there must never be one: `gmail_reply` is excluded
 * from the agent's tool allowlist and GMAIL_ALLOW_SENDING is unset, so no tool on
 * the box can send mail. `draft_email` means a draft lands in Gmail and the
 * principal presses send.
 */
export type ActionType = "draft_email" | "manual";

/** Widgets are rows in the database, never generated code. */
export type WidgetType = "metric" | "chart" | "list" | "checklist" | "approval";

export type Role = "owner" | "admin";

export type AccountStatus = "active" | "paused";

/**
 * How much of the principal's attention an item is asking for.
 *
 * A closed set, ours, matching the CHECK on `todos.attention`. The words a boss
 * reads come from ATTENTION_LABELS in i18n.ts and are looked up by key, so a
 * sender cannot author their own headline — the same containment the flag
 * vocabulary in EMAIL-INTELLIGENCE-DESIGN.md relies on.
 *
 * Adding a sixth level means: the CHECK in schema.sql, this union, and
 * ATTENTION_LABELS in BOTH languages. Miss any and the build or the insert
 * fails, which is the intended failure.
 *
 * This is NOT `priority`. Priority answers "what order do I work through the
 * queue in"; this answers "how much is at stake here". The two disagree
 * constantly — a low-priority note about a lapsing insurance policy is
 * critical — and deriving one from the other would file judgements nothing made.
 */
export type AttentionLevel =
  | "informational"
  | "attention"
  | "action_soon"
  | "urgent"
  | "critical";

/** Calmest first. Display order in the guide, and nothing else depends on it. */
export const ATTENTION_LEVELS: AttentionLevel[] = [
  "informational",
  "attention",
  "action_soon",
  "urgent",
  "critical",
];

/**
 * Default-deny, because rows arrive from PostgREST untyped and through a blind
 * `as` cast.
 *
 * Three things land here and all three must render as no block: null from a row
 * nothing has judged, undefined from a database where this file has not been
 * re-run, and a string outside the union. An unrecognised level has no
 * dictionary entry and would otherwise paint a coloured block with no name — a
 * warning that cannot say what it is warning about.
 */
export function isAttentionLevel(value: unknown): value is AttentionLevel {
  return (
    typeof value === "string" &&
    (ATTENTION_LEVELS as string[]).includes(value)
  );
}

/**
 * The reason is written by an analyser reading somebody else's mail, so it is
 * untrusted on the way in and bounded on the way out — the `MAX_KEY_CHARS`
 * argument in queue.tsx, applied to a field that is prose rather than a key.
 *
 * The clamp is a layout defence: a 4,000-character reason on a 375px screen
 * pushes Confirm, Modify and Reject off the card, which is a denial of service
 * delivered by email. Escaping is React's job and the render path adds no
 * markup, no linkification and no HTML.
 */
const MAX_REASON_CHARS = 180;

export function clampAttentionReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  return text.length <= MAX_REASON_CHARS
    ? text
    : `${text.slice(0, MAX_REASON_CHARS)}…`;
}

export interface Todo {
  id: string;
  title: string;
  action_type: ActionType;
  status: TodoStatus;
  priority: "low" | "normal" | "high";
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  /**
   * Null when nothing has judged this item — an older row, or one the box chose
   * not to rate. It renders as no block, never as the calmest level: absence of
   * a judgement is not a judgement that everything is fine.
   */
  attention: AttentionLevel | null;
  /** Optional even when a level is present. Untrusted; see clampAttentionReason. */
  attention_reason: string | null;
}

/**
 * Never reaches the browser through Supabase. `todo_payloads` has RLS on and no
 * anon policy, and is deliberately absent from the realtime publication. The only
 * way this arrives client-side is the server route, after a session check.
 */
export interface TodoPayload {
  todo_id: string;
  payload_proposed: DraftEmailPayload | ManualPayload;
  payload_current: DraftEmailPayload | ManualPayload;
  modify_note: string | null;
  reject_reason: string | null;
}

export interface DraftEmailPayload {
  to: string;
  subject: string;
  body: string;
}

/**
 * A manual item, as the box actually writes it.
 *
 * Every field is optional and unknown keys are representable on purpose. This
 * shape is produced on the box by an agent this repo never compiles against,
 * stored in a `jsonb` column Postgres enforces no shape on, and read back through
 * a blind `as` cast. That is three places a drift can hide, and it did: this
 * interface said `{ detail: string }` while a real row carried seven keys and no
 * `detail` at all, so the panel rendered empty and nothing — not the database, not
 * the compiler — was in a position to complain.
 *
 * So the rule here is describe, never require. A renderer that trusts this list to
 * be complete reproduces the same bug the day the box writes an eighth key, which
 * is why `queue.tsx` also renders whatever it finds that is not named below.
 */
export interface ManualPayload {
  /** The primary content: what the principal is being asked to actually do. */
  task?: string;
  /** Legacy. Older rows carry the whole item in this one string. Never assume it. */
  detail?: string;
  from?: string;
  subject?: string;
  event?: string;
  deadline?: string;
  location?: string;
  /** A Gmail message id. A reference to show, not a link — nothing can open it. */
  email_id?: string;
  /** jsonb holds anything, so a value is `unknown` until the renderer narrows it. */
  [key: string]: unknown;
}

export interface DashboardWidget {
  id: string;
  widget_type: WidgetType;
  title: string;
  config: WidgetConfig;
  position: number;
}

export type WidgetConfig =
  | { kind: "metric"; value: string; caption?: string; delta?: string }
  | { kind: "chart"; series: { label: string; value: number }[]; unit?: string }
  | { kind: "list"; items: { label: string; meta?: string }[] }
  | { kind: "checklist"; items: { label: string; done: boolean }[] }
  | { kind: "approval"; note: string };

export interface Profile {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  role: Role;
  status: AccountStatus;
  /**
   * Owner-granted. Lets an admin confirm, modify and reject queue items.
   * Never grants deletion — that is owner-only in every code path and in RLS.
   */
  can_modify: boolean;
  must_change_password: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  /**
   * The language this account reads in, or null when it has never been set.
   *
   * Null is not a default of English — it means nobody has said, so the browser
   * seeds it once from its own toggle. After that this is authoritative, which
   * is what lets the choice follow a person to a second device and what gives
   * the server a language it can act on rather than one it has to be told.
   */
  lang: Lang | null;
}

/** What the UI is allowed to render for the current session. */
export interface Permissions {
  canModify: boolean;
  canDelete: boolean;
  canManageTeam: boolean;
}

export function permissionsFor(profile: Pick<Profile, "role" | "can_modify">): Permissions {
  const isOwner = profile.role === "owner";
  return {
    // The owner always decides. An admin decides only if the owner ticked the box.
    canModify: isOwner || profile.can_modify,
    // Deletion is owner-only, unconditionally. `can_modify` never widens this.
    canDelete: isOwner,
    canManageTeam: isOwner,
  };
}
