import { describe, test, expect } from "bun:test";
import { MergePatch } from "@silo/shared/merge-patch";

/**
 * [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396), as `PATCH .../config`
 * uses it (D39) and as the admin UI has to produce it (D40).
 *
 * `diff` is the half worth testing hardest, because it is the one with a
 * plausible wrong answer: sending the edited document straight back looks
 * correct and cannot express a deletion.
 */
describe("MergePatch.apply", () => {
  test("null deletes a key rather than storing null", () => {
    expect(MergePatch.applyToObject({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  test("objects merge recursively", () => {
    expect(MergePatch.applyToObject({ a: { x: 1, y: 2 } }, { a: { y: 3 } })).toEqual({
      a: { x: 1, y: 3 },
    });
  });

  test("an array replaces whole, never element-wise", () => {
    expect(MergePatch.applyToObject({ tags: ["a", "b"] }, { tags: ["c"] })).toEqual({
      tags: ["c"],
    });
  });

  test("neither argument is mutated", () => {
    const target = { a: { x: 1 } };
    MergePatch.applyToObject(target, { a: { y: 2 } });
    expect(target).toEqual({ a: { x: 1 } });
  });
});

describe("MergePatch.diff", () => {
  test("an unchanged document produces an empty patch", () => {
    expect(MergePatch.diff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual({});
  });

  test("only what changed is sent", () => {
    expect(MergePatch.diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: 3 });
  });

  test("a removed key becomes null, which is how a patch deletes", () => {
    expect(MergePatch.diff({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: null });
  });

  /** The case that makes a diff necessary rather than convenient: the edited
   *  document sent as a patch would merge `y` straight back in. */
  test("a removed nested key becomes null at its own depth", () => {
    expect(MergePatch.diff({ a: { x: 1, y: 2 } }, { a: { x: 1 } })).toEqual({ a: { y: null } });
  });

  test("a value that changes type is replaced whole", () => {
    expect(MergePatch.diff({ a: { x: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(MergePatch.diff({ a: 5 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
  });

  test("an array is compared by value and replaced whole", () => {
    expect(MergePatch.diff({ tags: ["a"] }, { tags: ["a"] })).toEqual({});
    expect(MergePatch.diff({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual({ tags: ["a", "b"] });
  });
});

/**
 * The property the pair exists for. `diff` is only useful if the server's own
 * `apply` — the same class, which is why it moved to `shared` — lands exactly on
 * the document the operator was looking at.
 */
describe("diff then apply", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ["adds a key", { a: 1 }, { a: 1, b: 2 }],
    ["removes a key", { a: 1, b: 2 }, { a: 1 }],
    ["removes a nested key", { a: { x: 1, y: 2 } }, { a: { x: 1 } }],
    ["empties an object", { a: { x: 1 } }, { a: {} }],
    ["clears the whole document", { a: 1, b: { c: 2 } }, {}],
    ["replaces a scalar with an object", { a: 1 }, { a: { x: 1 } }],
    ["shortens an array", { tags: ["a", "b"] }, { tags: ["a"] }],
    ["changes nothing", { a: 1 }, { a: 1 }],
  ];

  test.each(cases)("%s", (_name, from, to) => {
    expect(MergePatch.applyToObject(from, MergePatch.diff(from, to))).toEqual(to);
  });
});
