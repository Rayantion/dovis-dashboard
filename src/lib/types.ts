/*
  These types mirror supabase/schema.sql exactly. If you change one, change both —
  the CHECK constraints in the database are the real enforcement, and a type that
  drifts from them will let you write code the database then rejects at runtime.
*/

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

export interface ManualPayload {
  detail: string;
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
