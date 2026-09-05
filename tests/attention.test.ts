import { describe, expect, it } from "vitest";
import { ATTENTION_LABELS, languages } from "@/lib/i18n";
import {
  ATTENTION_LEVELS,
  clampAttentionReason,
  isAttentionLevel,
} from "@/lib/types";
import { demoTodos } from "@/lib/demo-data";

/*
  The attention level is a judgement, and these tests pin the two ways a
  judgement can be faked: inventing one where none was made, and letting a level
  reach the screen without words a reader can act on.

  Rendering is not asserted here — the environment is node and there is no DOM —
  but the decision AttentionBlock makes before it renders anything is
  `isAttentionLevel`, and that is pure.
*/

describe("isAttentionLevel", () => {
  it("accepts exactly the five levels", () => {
    for (const level of ATTENTION_LEVELS) expect(isAttentionLevel(level)).toBe(true);
    expect(ATTENTION_LEVELS).toHaveLength(5);
  });

  it("rejects absence, so an unjudged row renders no block", () => {
    // Null is a row nobody judged. Undefined is a database where schema.sql has
    // not been re-run, arriving through the same blind cast. Neither is a level,
    // and neither may be read as the calmest one.
    for (const absent of [null, undefined, ""]) {
      expect(isAttentionLevel(absent)).toBe(false);
    }
  });

  it("rejects a value outside the union, however plausible", () => {
    // PostgREST hands rows over untyped, so the CHECK constraint is not the last
    // line of defence. A styled block with no name is worse than no block.
    for (const wrong of ["high", "low", "normal", "INFORMATIONAL", "warning", 3, {}]) {
      expect(isAttentionLevel(wrong)).toBe(false);
    }
  });

  it("is not the priority vocabulary", () => {
    // The two enums must stay incompatible in both directions: if either set
    // ever validated as the other, a silent mapping becomes possible.
    for (const priority of ["low", "normal", "high"]) {
      expect(isAttentionLevel(priority)).toBe(false);
    }
    expect(ATTENTION_LEVELS).not.toContain("high");
  });
});

describe("clampAttentionReason", () => {
  it("passes an ordinary reason through untouched", () => {
    const reason = "The quote expires at the end of the week.";
    expect(clampAttentionReason(reason)).toBe(reason);
  });

  it("bounds a reason that would push the buttons off a phone", () => {
    const clamped = clampAttentionReason("x".repeat(4000));
    expect(clamped.length).toBeLessThanOrEqual(181);
    expect(clamped.endsWith("…")).toBe(true);
  });

  it("treats anything that is not a string as no reason", () => {
    // jsonb-adjacent values and a missing column both land here.
    for (const value of [null, undefined, 42, {}, ["a"]]) {
      expect(clampAttentionReason(value)).toBe("");
    }
  });

  it("treats whitespace as no reason, so an empty line never renders", () => {
    expect(clampAttentionReason("   \n  ")).toBe("");
  });
});

describe("ATTENTION_LABELS", () => {
  it("carries a label and a meaning for every level in every language", () => {
    for (const lang of Object.keys(languages) as (keyof typeof languages)[]) {
      for (const level of ATTENTION_LEVELS) {
        const entry = ATTENTION_LABELS[lang][level];
        expect(entry.label.length).toBeGreaterThan(0);
        expect(entry.meaning.length).toBeGreaterThan(0);
      }
    }
  });

  it("never restates a judgement as certainty", () => {
    // A level is what Dovis thinks, not what it checked. Wording that claims
    // verification would turn every wrong call into an endorsement.
    const forbidden = /confirmed|verified|guaranteed|\bsafe\b|no risk/i;
    for (const lang of Object.keys(languages) as (keyof typeof languages)[]) {
      for (const level of ATTENTION_LEVELS) {
        const { label, meaning } = ATTENTION_LABELS[lang][level];
        expect(`${label} ${meaning}`).not.toMatch(forbidden);
      }
    }
  });
});

describe("demo fixtures", () => {
  it("shows all five levels, so the showcase cannot hide one that is broken", () => {
    const shown = new Set(demoTodos.map((t) => t.attention).filter(Boolean));
    for (const level of ATTENTION_LEVELS) expect(shown).toContain(level);
  });

  it("keeps the absence case visible, including on an item still waiting", () => {
    const unjudged = demoTodos.filter((t) => t.attention === null);
    expect(unjudged.length).toBeGreaterThan(0);
    expect(unjudged.some((t) => t.status === "proposed")).toBe(true);
  });

  it("keeps one judged item with no reason", () => {
    expect(
      demoTodos.some((t) => t.attention !== null && t.attention_reason === null),
    ).toBe(true);
  });

  it("never carries a reason without a level", () => {
    // A reason with nothing to explain is a judgement that lost its own name.
    expect(
      demoTodos.every((t) => t.attention !== null || t.attention_reason === null),
    ).toBe(true);
  });
});
