"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/config";
import {
  demoProfiles,
  demoPayloads,
  demoTodos,
  demoWidgets,
} from "@/lib/demo-data";
import {
  permissionsFor,
  type DashboardWidget,
  type Permissions,
  type Profile,
  type Todo,
  type TodoPayload,
} from "@/lib/types";

/*
  One provider, two backends.

  Demo mode keeps everything in React state seeded from fixtures, touches no
  network, and resets on reload. Real mode talks to Supabase: reads and status
  updates go direct (RLS is the enforcement), while anything involving draft
  bodies or account creation goes through a server route holding service_role.

  Components below this never branch on which mode they are in.
*/

export interface Session {
  profile: Profile;
}

/**
 * Health of the realtime socket, as far as the client can tell.
 *
 * `stale` is the one that matters. Postgres Changes gives no delivery guarantee:
 * it does not queue events for a disconnected client and does not track how far
 * each client has read, so anything that happened while the socket was down is
 * gone and will never arrive. Only a refetch recovers it — which is why a manual
 * refresh path exists at all rather than trusting the stream.
 */
export type Connection = "connecting" | "live" | "stale" | "offline";

interface Ctx {
  ready: boolean;
  demo: boolean;
  session: Session | null;
  perms: Permissions;
  todos: Todo[];
  widgets: DashboardWidget[];
  profiles: Profile[];
  connection: Connection;
  /** Queue changes received but deliberately not applied. Drives the banner. */
  pendingCount: number;
  refreshing: boolean;
  refresh: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<string | null>;
  loadPayload: (todoId: string) => Promise<TodoPayload | null>;
  act: (
    todoId: string,
    action: "confirm" | "modify" | "reject",
    note?: string,
  ) => Promise<string | null>;
  createAdmin: (input: {
    email: string;
    username: string;
    displayName: string;
  }) => Promise<{ tempPassword: string } | { error: string }>;
  updateAdmin: (
    id: string,
    patch: { can_modify?: boolean; status?: "active" | "paused" },
  ) => Promise<string | null>;
  removeAdmin: (id: string) => Promise<string | null>;
  clearCompleted: () => Promise<string | null>;
  deleteAllTodos: () => Promise<string | null>;
}

const DovisContext = React.createContext<Ctx | null>(null);

export function useDovis() {
  const ctx = React.useContext(DovisContext);
  if (!ctx) throw new Error("useDovis must be used inside <DovisProvider>");
  return ctx;
}

const DEMO_SESSION_KEY = "dovis.demo.session";

/** Readable, unambiguous temp password. No l/1/O/0. */
function makeTempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * The one read path. Bootstrap, reconnect and the refresh button all go through
 * here so there is a single definition of "what the dashboard should be showing"
 * — the stream is an optimisation on top of this, never a substitute for it.
 *
 * `profiles` comes back null for an assistant: RLS would return their own row
 * only, and overwriting the list with that would be worse than leaving it alone.
 */
async function fetchAll(supabase: Client, profile: Profile) {
  const [t, w] = await Promise.all([
    supabase.from("todos").select("*").order("created_at", { ascending: false }),
    supabase.from("dashboard_widgets").select("*").order("position"),
  ]);
  const profiles =
    profile.role === "owner"
      ? ((await supabase.from("profiles").select("*").order("created_at")).data ?? [])
      : null;
  return {
    todos: (t.data ?? []) as Todo[],
    widgets: (w.data ?? []) as DashboardWidget[],
    profiles: profiles as Profile[] | null,
  };
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json } as { ok: boolean; json: Record<string, unknown> };
}

export function DovisProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [widgets, setWidgets] = React.useState<DashboardWidget[]>([]);
  const [profiles, setProfiles] = React.useState<Profile[]>([]);
  // Demo-only: mutations to draft bodies live here so Modify/Reject actually work.
  const [payloads, setPayloads] =
    React.useState<Record<string, TodoPayload>>(demoPayloads);
  const [connection, setConnection] = React.useState<Connection>(
    isDemoMode ? "live" : "connecting",
  );
  const [pendingCount, setPendingCount] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);

  const supabase = React.useMemo(() => createClient(), []);

  /*
    Realtime handlers need to know whether a row is already on screen without
    re-subscribing every time the list changes, and without doing that lookup
    inside a state updater (StrictMode runs those twice).
  */
  const todosRef = React.useRef<Todo[]>([]);
  React.useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  // ---------------------------------------------------------------- bootstrap
  React.useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (isDemoMode) {
        const stored =
          typeof window !== "undefined"
            ? window.sessionStorage.getItem(DEMO_SESSION_KEY)
            : null;
        const profile = stored
          ? (demoProfiles.find((p) => p.id === stored) ?? null)
          : null;
        if (cancelled) return;
        setSession(profile ? { profile } : null);
        setTodos(demoTodos);
        setWidgets(demoWidgets);
        setProfiles(demoProfiles);
        setReady(true);
        return;
      }

      if (!supabase) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setSession(null);
          setReady(true);
        }
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (!profile) {
        setSession(null);
        setReady(true);
        return;
      }
      setSession({ profile: profile as Profile });
      const initial = await fetchAll(supabase, profile as Profile);
      if (cancelled) return;
      setTodos(initial.todos);
      setWidgets(initial.widgets);
      if (initial.profiles) setProfiles(initial.profiles);
      setReady(true);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ------------------------------------------------------------------ refresh
  const refresh = React.useCallback(async () => {
    // Demo data cannot change underneath anyone, so there is nothing to fetch.
    // The control stays mounted and simply clears — a disabled button on the
    // showcase would read as broken rather than as "nothing to do".
    if (isDemoMode || !supabase || !session) {
      setPendingCount(0);
      return;
    }
    setRefreshing(true);
    try {
      const next = await fetchAll(supabase, session.profile);
      setTodos(next.todos);
      setWidgets(next.widgets);
      if (next.profiles) setProfiles(next.profiles);
      setPendingCount(0);
    } finally {
      setRefreshing(false);
    }
  }, [supabase, session]);

  // Held in a ref so the realtime effect can call the current refresh without
  // taking it as a dependency — otherwise every session change tears down and
  // re-establishes the channel.
  const refreshRef = React.useRef(refresh);
  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // ----------------------------------------------------------------- realtime
  React.useEffect(() => {
    if (isDemoMode || !supabase || !session) return;

    /*
      Local, not a ref: it resets naturally when the channel is rebuilt, which is
      exactly the lifetime we want to reason about.
    */
    let connectedOnce = false;

    const channel = supabase
      .channel("dovis-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todos" },
        (payload) => {
          /*
            Updates to a row already on screen apply immediately. They are status
            transitions (proposed → confirmed → executing → done) and the list is
            ordered by created_at, so nothing moves — the row you are looking at
            just tells you the truth about itself.

            Inserts and deletes reshape the list, so they wait behind the banner.
            A new proposal prepends; if one lands while the owner is reaching for
            Confirm, every row shifts down one and they approve the wrong item —
            which drafts mail in their own name. Freshness is not worth that.
          */
          if (payload.eventType === "UPDATE") {
            const row = payload.new as Todo;
            if (todosRef.current.some((t) => t.id === row.id)) {
              setTodos((prev) => prev.map((t) => (t.id === row.id ? row : t)));
              return;
            }
          }
          setPendingCount((n) => n + 1);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dashboard_widgets" },
        async () => {
          // Widgets are ambient readouts, not controls that act on the owner's
          // behalf, so there is no misclick to protect against. They stay live.
          const { data } = await supabase
            .from("dashboard_widgets")
            .select("*")
            .order("position");
          setWidgets((data ?? []) as DashboardWidget[]);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection("live");
          // Everything that happened while the socket was down is unrecoverable
          // from the stream itself, and the gap length is unknowable from here.
          // A refetch is the only way back to truth — and it is one query.
          if (connectedOnce) void refreshRef.current();
          connectedOnce = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("stale");
          return;
        }
        if (status === "CLOSED") setConnection("offline");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, session]);

  // -------------------------------------------------------------------- auth
  const signIn = React.useCallback(
    async (identifier: string, password: string): Promise<string | null> => {
      const id = identifier.trim().toLowerCase();

      if (isDemoMode) {
        const profile = demoProfiles.find(
          (p) => p.username === id || p.email === id,
        );
        if (!profile) return "No account with that username or email.";
        if (password !== "demo") return "Wrong password. In demo mode it is “demo”.";
        if (profile.status === "paused")
          return "This account is paused. Ask the owner to resume it.";
        window.sessionStorage.setItem(DEMO_SESSION_KEY, profile.id);
        setSession({ profile });
        return null;
      }

      if (!supabase) return "Supabase is not configured.";

      // Username sign-in needs the email behind it, and the mapping lives in a
      // table the browser cannot read for other users. The server resolves it.
      let email = id;
      if (!id.includes("@")) {
        const { ok, json } = await post("/api/auth/resolve", { username: id });
        if (!ok || typeof json.email !== "string")
          return "No account with that username.";
        email = json.email;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return "Wrong username, email, or password.";

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return "Sign-in did not complete. Try again.";

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!profile) {
        await supabase.auth.signOut();
        return "This user has no Dovis profile. The owner must create one.";
      }
      if ((profile as Profile).status === "paused") {
        await supabase.auth.signOut();
        return "This account is paused. Ask the owner to resume it.";
      }

      setSession({ profile: profile as Profile });
      return null;
    },
    [supabase],
  );

  const signOut = React.useCallback(async () => {
    if (isDemoMode) {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
      setSession(null);
      return;
    }
    await supabase?.auth.signOut();
    setSession(null);
  }, [supabase]);

  const changePassword = React.useCallback(
    async (newPassword: string): Promise<string | null> => {
      if (newPassword.length < 10)
        return "Use at least 10 characters. This account can read your mail.";

      if (isDemoMode) {
        setSession((s) =>
          s ? { profile: { ...s.profile, must_change_password: false } } : s,
        );
        return null;
      }
      if (!supabase) return "Supabase is not configured.";

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return error.message;

      const { ok, json } = await post("/api/auth/password-changed", {});
      if (!ok) return (json.error as string) ?? "Could not clear the temporary flag.";

      setSession((s) =>
        s ? { profile: { ...s.profile, must_change_password: false } } : s,
      );
      return null;
    },
    [supabase],
  );

  // ------------------------------------------------------------------ queue
  const loadPayload = React.useCallback(
    async (todoId: string): Promise<TodoPayload | null> => {
      if (isDemoMode) return payloads[todoId] ?? null;
      const res = await fetch(`/api/payload/${todoId}`);
      if (!res.ok) return null;
      return (await res.json()) as TodoPayload;
    },
    [payloads],
  );

  const act = React.useCallback(
    async (
      todoId: string,
      action: "confirm" | "modify" | "reject",
      note?: string,
    ): Promise<string | null> => {
      const nextStatus =
        action === "confirm"
          ? ("confirmed" as const)
          : action === "modify"
            ? ("modifying" as const)
            : ("rejected" as const);

      if (isDemoMode) {
        setTodos((prev) =>
          prev.map((t) =>
            t.id === todoId
              ? {
                  ...t,
                  status: nextStatus,
                  confirmed_at:
                    action === "confirm" ? new Date().toISOString() : t.confirmed_at,
                }
              : t,
          ),
        );
        if (note) {
          setPayloads((prev) => ({
            ...prev,
            [todoId]: {
              ...prev[todoId],
              modify_note: action === "modify" ? note : prev[todoId]?.modify_note,
              reject_reason: action === "reject" ? note : prev[todoId]?.reject_reason,
            },
          }));
        }
        // Confirming does not complete anything. On a real box the executor cron
        // claims the row, acts, and only then marks it done. Mirrored here so the
        // demo does not imply the dashboard performs the action itself.
        if (action === "confirm") {
          window.setTimeout(() => {
            setTodos((prev) =>
              prev.map((t) =>
                t.id === todoId && t.status === "confirmed"
                  ? { ...t, status: "executing" }
                  : t,
              ),
            );
          }, 900);
          window.setTimeout(() => {
            setTodos((prev) =>
              prev.map((t) =>
                t.id === todoId && t.status === "executing"
                  ? { ...t, status: "done", completed_at: new Date().toISOString() }
                  : t,
              ),
            );
          }, 3200);
        }
        return null;
      }

      const { ok, json } = await post("/api/act", { todoId, action, note });
      return ok ? null : ((json.error as string) ?? "Could not update that item.");
    },
    [],
  );

  // ------------------------------------------------------------------- team
  const createAdmin = React.useCallback(
    async (input: { email: string; username: string; displayName: string }) => {
      if (isDemoMode) {
        const tempPassword = makeTempPassword();
        const profile: Profile = {
          id: `p${Math.random().toString(36).slice(2, 8)}`,
          email: input.email.toLowerCase(),
          username: input.username.toLowerCase(),
          display_name: input.displayName || null,
          role: "admin",
          status: "active",
          can_modify: false,
          must_change_password: true,
          created_at: new Date().toISOString(),
          last_sign_in_at: null,
        };
        setProfiles((prev) => [...prev, profile]);
        return { tempPassword };
      }
      const { ok, json } = await post("/api/team/create", input);
      if (!ok) return { error: (json.error as string) ?? "Could not create account." };
      setProfiles((prev) => [...prev, json.profile as Profile]);
      return { tempPassword: json.tempPassword as string };
    },
    [],
  );

  const updateAdmin = React.useCallback(
    async (
      id: string,
      patch: { can_modify?: boolean; status?: "active" | "paused" },
    ): Promise<string | null> => {
      if (isDemoMode) {
        setProfiles((prev) =>
          prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        );
        return null;
      }
      const { ok, json } = await post("/api/team/update", { id, ...patch });
      if (ok) setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      return ok ? null : ((json.error as string) ?? "Could not update that account.");
    },
    [],
  );

  const removeAdmin = React.useCallback(async (id: string): Promise<string | null> => {
    if (isDemoMode) {
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      return null;
    }
    const { ok, json } = await post("/api/team/remove", { id });
    if (ok) setProfiles((prev) => prev.filter((p) => p.id !== id));
    return ok ? null : ((json.error as string) ?? "Could not remove that account.");
  }, []);

  // ------------------------------------------------------------ danger zone
  const clearCompleted = React.useCallback(async (): Promise<string | null> => {
    if (isDemoMode) {
      setTodos((prev) =>
        prev.filter((t) => t.status !== "done" && t.status !== "rejected"),
      );
      return null;
    }
    const { ok, json } = await post("/api/queue/clear-completed", {});
    return ok ? null : ((json.error as string) ?? "Could not clear the queue.");
  }, []);

  const deleteAllTodos = React.useCallback(async (): Promise<string | null> => {
    if (isDemoMode) {
      setTodos([]);
      return null;
    }
    const { ok, json } = await post("/api/queue/delete-all", {});
    return ok ? null : ((json.error as string) ?? "Could not delete the queue.");
  }, []);

  const perms: Permissions = session
    ? permissionsFor(session.profile)
    : { canModify: false, canDelete: false, canManageTeam: false };

  const value: Ctx = {
    ready,
    demo: isDemoMode,
    session,
    perms,
    todos,
    widgets,
    profiles,
    connection,
    pendingCount,
    refreshing,
    refresh,
    signIn,
    signOut,
    changePassword,
    loadPayload,
    act,
    createAdmin,
    updateAdmin,
    removeAdmin,
    clearCompleted,
    deleteAllTodos,
  };

  return <DovisContext.Provider value={value}>{children}</DovisContext.Provider>;
}
