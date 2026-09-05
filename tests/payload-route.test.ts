import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Profile } from "@/lib/types";

/*
  `/api/payload/[id]` is the only route by which a drafted email body reaches a
  browser: `todo_payloads` has RLS on with no client policy and is absent from
  the realtime publication, so this handler plus service_role is the entire
  surface.

  It used to require only a session, which meant any signed-in assistant could
  read every draft Dovis had ever written for the owner. These tests pin the
  decision Aaron made on 2026-09-05: the gate is `can_modify`, the same switch
  the owner already turns on to let someone review proposals.

  The Supabase layer is mocked because what is under test is the authorization
  branch, not Postgres. `permissionsFor` is deliberately NOT mocked — it is the
  logic being asserted.
*/

const requireProfile = vi.fn();
const createAdmin = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  requireProfile: () => requireProfile(),
  createAdmin: () => createAdmin(),
  isFailure: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

const { GET } = await import("@/app/api/payload/[id]/route");

const PAYLOAD = { todo_id: "t1", subject: "Q3 budget", body: "Dear Stanley," };

/** Minimal stand-in for the service_role client this route uses. */
function stubAdmin(result: { data: unknown; error: unknown } = { data: PAYLOAD, error: null }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => result }),
      }),
    }),
  };
}

function profile(over: Partial<Profile>): Profile {
  return {
    id: "p1",
    email: "someone@example.com",
    username: "someone",
    display_name: null,
    role: "admin",
    status: "active",
    can_modify: false,
    must_change_password: false,
    created_at: "2026-09-01T00:00:00Z",
    last_sign_in_at: null,
    ...over,
  } as Profile;
}

const params = Promise.resolve({ id: "t1" });
const call = () => GET(new Request("http://localhost/api/payload/t1"), { params });

beforeEach(() => {
  requireProfile.mockReset();
  createAdmin.mockReset();
  createAdmin.mockReturnValue(stubAdmin());
});

describe("GET /api/payload/[id]", () => {
  it("lets the owner read a draft body", async () => {
    requireProfile.mockResolvedValue({ profile: profile({ role: "owner" }) });

    const res = await call();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ subject: "Q3 budget" });
  });

  it("lets an assistant the owner has granted can_modify read a draft body", async () => {
    requireProfile.mockResolvedValue({
      profile: profile({ role: "admin", can_modify: true }),
    });

    const res = await call();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ subject: "Q3 budget" });
  });

  it("denies a read-only assistant with 403 and never reaches the database", async () => {
    requireProfile.mockResolvedValue({
      profile: profile({ role: "admin", can_modify: false }),
    });

    const res = await call();

    expect(res.status).toBe(403);
    // The check must short-circuit. Querying and then discarding the row would
    // still have pulled the draft body into the server's memory and its logs.
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before any permission logic runs", async () => {
    requireProfile.mockResolvedValue({ error: "Not signed in", status: 401 });

    const res = await call();

    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("rejects a paused account, which requireProfile refuses upstream", async () => {
    requireProfile.mockResolvedValue({ error: "This account is paused", status: 403 });

    const res = await call();

    expect(res.status).toBe(403);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("does not let a role claimed by the caller widen access", async () => {
    // The handler derives permission from the profile row that requireProfile
    // read under service_role. Anything in the request is not evidence.
    requireProfile.mockResolvedValue({
      profile: profile({ role: "admin", can_modify: false }),
    });

    const res = await GET(
      new Request("http://localhost/api/payload/t1", {
        headers: { "x-role": "owner", "x-can-modify": "true" },
      }),
      { params },
    );

    expect(res.status).toBe(403);
  });

  it("keeps draft bodies out of shared and disk caches", async () => {
    requireProfile.mockResolvedValue({ profile: profile({ role: "owner" }) });

    const res = await call();

    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("cache-control")).toContain("private");
  });

  it("returns 404 rather than an empty body when no payload exists", async () => {
    requireProfile.mockResolvedValue({ profile: profile({ role: "owner" }) });
    createAdmin.mockReturnValue(stubAdmin({ data: null, error: null }));

    const res = await call();

    expect(res.status).toBe(404);
  });
});
