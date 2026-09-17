import { describe, test, expect } from "bun:test";
import { Scope } from "../../src/core/domain/scope";
import { MediaModes } from "../../src/core/transfer/media-mode";
import { TransferSelection } from "../../src/core/transfer/transfer-selection";

describe("TransferSelection", () => {
  test("an empty list is the whole instance, not an empty one", () => {
    // An absent selection and an empty one arrive indistinguishably over a
    // query string, so "nothing matches" must not be representable by accident.
    const selection = TransferSelection.parse([]);
    expect(selection.isEverything).toBe(true);
    expect(selection.coversCollection(Scope.Default, "anything")).toBe(true);
  });

  test("each depth covers exactly what it names", () => {
    const selection = TransferSelection.parse(["blog", "site/prod", "shop/prod/orders"]);

    expect(selection.coversScope(Scope.of("blog", "staging"))).toBe(true);
    expect(selection.coversCollection(Scope.of("blog", "staging"), "posts")).toBe(true);

    expect(selection.coversScope(Scope.of("site", "prod"))).toBe(true);
    expect(selection.coversScope(Scope.of("site", "staging"))).toBe(false);
    expect(selection.coversCollection(Scope.of("site", "prod"), "pages")).toBe(true);

    expect(selection.coversCollection(Scope.of("shop", "prod"), "orders")).toBe(true);
    expect(selection.coversCollection(Scope.of("shop", "prod"), "customers")).toBe(false);
    expect(selection.coversProject("shop")).toBe(true);
    expect(selection.coversProject("other")).toBe(false);
  });

  test("overlapping rules are a union, not a conflict", () => {
    const selection = TransferSelection.parse(["site", "site/prod/posts"]);
    expect(selection.coversCollection(Scope.of("site", "staging"), "pages")).toBe(true);
  });

  test("a system collection can never be named", () => {
    // A selection that could name `_keys` would be a second, unguarded way past
    // the keys claim.
    expect(() => TransferSelection.parse(["site/prod/_keys"])).toThrow(/invalid selected collection/);
    expect(() => TransferSelection.parse(["site/prod/_media"])).toThrow(/invalid selected collection/);
  });

  test("malformed rules are refused before any storage read", () => {
    expect(() => TransferSelection.parse(["a/b/c/d"])).toThrow(/want project/);
    expect(() => TransferSelection.parse(["site//posts"])).toThrow(/want project/);
    expect(() => TransferSelection.parse([""])).toThrow(/non-empty string/);
    expect(() => TransferSelection.parse(["Site"])).toThrow(/invalid project/);
    expect(() => TransferSelection.parse(["site/PROD"])).toThrow(/invalid env/);
    expect(() => TransferSelection.parse(["site", "site"])).toThrow(/duplicate selection/);
  });

  test("describe is sorted, so two equivalent selections describe themselves alike", () => {
    expect(TransferSelection.parse(["b/prod", "a"]).describe()).toEqual(["a", "b/prod"]);
    expect(TransferSelection.parse(["a", "b/prod"]).describe()).toEqual(["a", "b/prod"]);
  });

  test("a round trip through the structured form keeps the rules", () => {
    const rules = ["shop/prod/orders", "site"];
    expect(TransferSelection.of(TransferSelection.parse(rules).toIncludes()).describe()).toEqual(rules);
  });
});

describe("MediaModes", () => {
  test("a whole export stays lossless; a narrowed one narrows its media too", () => {
    // Dropping unreferenced uploads from the default whole-instance export
    // would make it quietly unable to restore the library it came from.
    expect(MediaModes.default(false)).toBe(MediaModes.All);
    expect(MediaModes.default(true)).toBe(MediaModes.Referenced);
  });

  test("an absent value takes the default and a bad one is refused", () => {
    expect(MediaModes.parse(undefined, false)).toBe(MediaModes.All);
    expect(MediaModes.parse("", true)).toBe(MediaModes.Referenced);
    expect(MediaModes.parse("none", false)).toBe(MediaModes.None);
    expect(() => MediaModes.parse("some", false)).toThrow(/invalid media mode/);
  });
});
