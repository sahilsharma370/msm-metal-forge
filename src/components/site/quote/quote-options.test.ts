// @vitest-environment node
import { describe, expect, it } from "vitest";
import { QUOTE_TOTAL_STAGES, STAGE_ENTRY_STEP, stageOf } from "./quote-options";

/**
 * C2L-Q1 — `stageOf` is the entire legacy-draft migration mechanism: a
 * pure, stable function applied at render time, not a stored-data rewrite.
 * This locks the exact old-step -> new-stage table the task specified, and
 * proves it can never "re-migrate" a value (idempotent by construction —
 * there's nothing to persist differently for an old vs. a fresh draft).
 */
describe("stageOf — legacy 6-step draft -> 5-stage migration mapping", () => {
  it("maps every internal step to the specified stage exactly once", () => {
    expect(stageOf(1)).toBe(1);
    expect(stageOf(2)).toBe(2);
    expect(stageOf(3)).toBe(2);
    expect(stageOf(4)).toBe(3);
    expect(stageOf(5)).toBe(4);
    expect(stageOf(6)).toBe(5);
  });

  it("is idempotent — re-applying it to its own output range never changes an already-correct stage", () => {
    for (let step = 1; step <= 6; step += 1) {
      const stage = stageOf(step);
      expect(stageOf(STAGE_ENTRY_STEP[stage]!)).toBe(stage);
    }
  });

  it("STAGE_ENTRY_STEP round-trips through stageOf for every stage", () => {
    for (let stage = 1; stage <= QUOTE_TOTAL_STAGES; stage += 1) {
      expect(stageOf(STAGE_ENTRY_STEP[stage]!)).toBe(stage);
    }
  });
});
