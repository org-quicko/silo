import { describe, expect, test } from "bun:test";
import { SearchTokens } from "../../core/search/search-tokens";

/**
 * The parity fixtures (D30). Each expectation was read out of SQLite itself
 * with `fts5vocab` over `unicode61 remove_diacritics 2` — not guessed — so
 * when `SqliteSearcher` lands in P2 it has a target to match rather than a
 * description to interpret.
 *
 * Exact parity across all of Unicode is not achievable: SQLite's character
 * tables and the JavaScript engine's are different versions of different data.
 * That is why the contract is parity on *these*, and why the suite is the
 * place the contract lives.
 */
describe("tokenizer parity with FTS5 unicode61", () => {
  const cases: [string, string[]][] = [
    ["foo_bar baz", ["foo", "bar", "baz"]],
    ["01J8XQ4Z8K9M2P3R5T7V9X1B3D", ["01j8xq4z8k9m2p3r5t7v9x1b3d"]],
    ["https://silo.dev/a/b?x=1", ["https", "silo", "dev", "a", "b", "x", "1"]],
    ["Café CRÈME", ["cafe", "creme"]],
    ["don't", ["don", "t"]],
    ["e-mail", ["e", "mail"]],
    // unicode61 does not segment CJK, so a run is one term. This is why those
    // deployments must select the trigram tokenizer — it is not a preference.
    ["日本語のテキスト", ["日本語のテキスト"]],
  ];

  for (const [input, want] of cases) {
    test(JSON.stringify(input), () => {
      expect(SearchTokens.tokenize(input)).toEqual(want);
    });
  }
});

describe("query parsing", () => {
  test("the last term is a prefix so typing feels like type-ahead", () => {
    const q = SearchTokens.parseQuery("hello wor");
    expect(q.terms).toEqual(["hello", "wor"]);
    expect(q.prefixLast).toBe(true);
  });

  test("a trailing separator means the user finished the word", () => {
    expect(SearchTokens.parseQuery("hello ").prefixLast).toBe(false);
    expect(SearchTokens.parseQuery("hello").prefixLast).toBe(true);
  });

  test("empty text yields no terms", () => {
    expect(SearchTokens.parseQuery("   ").terms).toEqual([]);
    expect(SearchTokens.parseQuery("").terms).toEqual([]);
  });
});

describe("matching", () => {
  const tokens = new Set(["hello", "world", "cafe"]);

  test("every term must be present", () => {
    expect(SearchTokens.matchesAll(tokens, SearchTokens.parseQuery("hello world"))).toBe(true);
    expect(SearchTokens.matchesAll(tokens, SearchTokens.parseQuery("hello missing"))).toBe(false);
  });

  test("only the final term matches as a prefix", () => {
    expect(SearchTokens.matchesAll(tokens, SearchTokens.parseQuery("wor"))).toBe(true);
    // "hel" is not the last term here, so it must match whole.
    expect(SearchTokens.matchesAll(tokens, SearchTokens.parseQuery("hel world"))).toBe(false);
  });

  test("a diacritic in the query folds the same way as in the text", () => {
    expect(SearchTokens.matchesAll(tokens, SearchTokens.parseQuery("café"))).toBe(true);
  });

  test("no terms never matches — an empty query is handled by the caller", () => {
    expect(SearchTokens.matchesAll(tokens, SearchTokens.parseQuery(""))).toBe(false);
  });
});

describe("fold mapping", () => {
  test("folded offsets map back to the original text", () => {
    const { folded, map } = SearchTokens.foldWithMap("Café au lait");
    expect(folded).toBe("cafe au lait");
    const at = folded.indexOf("au");
    // The original keeps its accent, so a snippet can quote it verbatim.
    expect("Café au lait".slice(map[at], map[at + 2])).toBe("au");
  });
});
