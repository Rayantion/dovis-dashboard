import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Profile } from "@/lib/types";

/*
  `/api/account/language` writes one column on the caller's own profile.

  It exists because `profiles` has no self-update policy — the only UPDATE
  policy is `owner updates`, gated on `dovis_is_owner()` — so an assistant
  cannot write their own row from the browser at all, and an owner could write
  *any* row including `role`. These tests pin the two properties that make the
  route narrower than the policy it stands in for: the account comes from the
  session, and the value comes from a two-item union.
*/

const requireProfile = vi.fn();
const update = vi.fn();
const eq = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  requireProfile: () => requireProfile(),
  createAdmin: () => ({ from: () => ({ update }) }),
  isFailure: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

const { POST } = await import("@/app/api/account/language/route");

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
    lang: null,
    ...over,
  } as Profile;
}

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/account/language", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  requireProfile.mockReset();
  update.mockReset();
  eq.mockReset();
  eq.mockResolvedValue({ error: null });
  update.mockReturnValue({ eq });
  requireProfile.mockResolvedValue({ profile: profile({}) });
});

describe("POST /api/account/language", () => {
  it("saves a supported language against the caller's own profile", async () => {
    const res = await post({ lang: "zh-TW" });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ lang: "zh-TW" });
    expect(eq).toHaveBeenCalledWith("id", "p1");
  });

  it("accepts a read-only assistant — a preference is not a permission", async () => {
    requireProfile.mockResolvedValue({
      profile: profile({ role: "admin", can_modify: false }),
    });

    const res = await post({ lang: "en" });

    expect(res.status).toBe(200);
  });

  it("writes the session's profile id, never one supplied in the body", async () => {
    // The id is the half that matters: without this, any signed-in account
    // could rewrite anyone else's settings.
    const res = await post({ lang: "en", id: "someone-else" });

    expect(res.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("id", "p1");
    expect(eq).not.toHaveBeenCalledWith("id", "someone-else");
  });

  it("rejects a language outside the union and writes nothing", async () => {
    for (const lang of ["fr", "ZH-tw", "en-US", "", "zh_TW"]) {
      update.mockClear();
      const res = await post({ lang });

      expect(res.status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("rejects non-string values that a loose check would let through", async () => {
    for (const lang of [null, 1, true, ["en"], { toString: () => "en" }]) {
      update.mockClear();
      const res = await post({ lang });

      expect(res.status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("does not echo the rejected value back", async () => {
    const res = await post({ lang: "<script>alert(1)</script>" });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).not.toContain("script");
  });

  it("rejects a malformed body", async () => {
    const res = await post("not json");

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before touching the database", async () => {
    requireProfile.mockResolvedValue({ error: "Not signed in", status: 401 });

    const res = await post({ lang: "en" });

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a paused account, which requireProfile refuses upstream", async () => {
    requireProfile.mockResolvedValue({ error: "This account is paused", status: 403 });

    const res = await post({ lang: "en" });

    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("surfaces a database failure rather than reporting success", async () => {
    eq.mockResolvedValue({ error: { message: "connection reset" } });

    const res = await post({ lang: "en" });

    expect(res.status).toBe(500);
  });
});
