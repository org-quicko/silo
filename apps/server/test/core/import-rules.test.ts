import { describe, expect, test } from "bun:test";
import { ImportRules } from "../../src/core/transfer/import-rules";

/**
 * The last tie-break of a merge (D110): when two instances hold an entry with
 * the same `updated_at` and `rev`, both must keep the same one, or each keeps
 * its own and they never agree.
 */
describe("import rules", () => {
  test("an exact tie goes to the higher instance id, whichever side imports", () => {
    const same = { updated_at: new Date("2026-01-01T00:00:00Z"), rev: 3 };
    // "A" loads "B"'s copy, then "B" loads "A"'s: "B"'s copy is kept both times.
    expect(ImportRules.incomingWins(same, same, undefined, "B", "A")).toBe(true);
    expect(ImportRules.incomingWins(same, same, undefined, "A", "B")).toBe(false);
  });
});
