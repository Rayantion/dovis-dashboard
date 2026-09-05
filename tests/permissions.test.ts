import { describe, expect, it } from "vitest";
import { permissionsFor } from "@/lib/types";

/*
  The whole permission model in one table. `permissionsFor` is pure and every
  authorization decision in the app derives from it, so pinning the matrix here
  means a change to the rules cannot pass silently — it has to break a test that
  states the old rule in words.
*/

describe("permissionsFor", () => {
  it("gives the owner everything, regardless of can_modify", () => {
    for (const can_modify of [true, false]) {
      expect(permissionsFor({ role: "owner", can_modify })).toEqual({
        canModify: true,
        canDelete: true,
        canManageTeam: true,
      });
    }
  });

  it("gives a read-only assistant nothing", () => {
    expect(permissionsFor({ role: "admin", can_modify: false })).toEqual({
      canModify: false,
      canDelete: false,
      canManageTeam: false,
    });
  });

  it("lets can_modify grant modify and nothing else", () => {
    expect(permissionsFor({ role: "admin", can_modify: true })).toEqual({
      canModify: true,
      canDelete: false,
      canManageTeam: false,
    });
  });

  it("never lets can_modify widen deletion", () => {
    // Deletion is owner-only unconditionally. This is the invariant the Danger
    // zone's typed confirmation rests on, so it is worth its own assertion
    // rather than being implied by the row above.
    expect(permissionsFor({ role: "admin", can_modify: true }).canDelete).toBe(false);
  });

  it("never lets can_modify grant team management", () => {
    expect(permissionsFor({ role: "admin", can_modify: true }).canManageTeam).toBe(false);
  });
});
