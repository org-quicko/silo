/**
 * The one string order every `Storage` adapter answers in: Unicode codepoint
 * order, which is what SQLite's `BINARY` and Postgres's `COLLATE "C"` give
 * over UTF-8 (D92).
 *
 * JavaScript's own `<` compares UTF-16 code units, which disagrees with
 * codepoint order once a character outside the Basic Multilingual Plane meets
 * one in U+E000–U+FFFF; `localeCompare` depends on the runtime's locale. Neither
 * can be matched by a database, so neither is the contract.
 */
export class CodepointOrder {
  /** Negative, zero or positive, as `Array.prototype.sort` expects. */
  static compare(left: string, right: string): number {
    const shorter = Math.min(left.length, right.length);
    for (let index = 0; index < shorter; index++) {
      let leftUnit = left.charCodeAt(index);
      let rightUnit = right.charCodeAt(index);
      if (leftUnit === rightUnit) continue;
      // Surrogates (U+D800–U+DFFF) encode codepoints above U+FFFF, so they must
      // sort after U+E000–U+FFFF rather than before it.
      if (leftUnit >= 0xd800 && rightUnit >= 0xd800) {
        leftUnit = CodepointOrder.fixup(leftUnit);
        rightUnit = CodepointOrder.fixup(rightUnit);
      }
      return leftUnit - rightUnit;
    }
    return left.length - right.length;
  }

  private static fixup(unit: number): number {
    return unit >= 0xe000 ? unit - 0x800 : unit + 0x2000;
  }
}
