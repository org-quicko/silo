import { describe, expect, test } from "bun:test";
import { PgParams } from "../../src/adapters/storage/postgres/pg-params";
import { PgSearchDocument } from "../../src/adapters/storage/postgres/pg-search-document";
import { PgSearchText } from "../../src/adapters/storage/postgres/pg-search-text";
import { SearchTokens } from "../../src/core/search/search-tokens";

describe("PgSearchDocument", () => {
  test("the vector carries SearchTokens' terms, each once, label as A and body as B", () => {
    expect(PgSearchDocument.vector("Café Central", "We met at the café")).toBe(
      "'cafe':1A,7B 'central':2A 'we':3B 'met':4B 'at':5B 'the':6B"
    );
  });

  test("a URL, an e-mail address and a hyphenated word split the way the scan splits them", () => {
    // Postgres's own parser would keep each of these whole; the index must not.
    expect(PgSearchDocument.vector("", "https://silo.dev/a e-mail don't")).toBe(
      "'https':1B 'silo':2B 'dev':3B 'a':4B 'e':5B 'mail':6B 'don':7B 't':8B"
    );
  });

  test("a term too long for a lexeme is left out rather than failing the write", () => {
    const long = "x".repeat(3000);
    expect(PgSearchDocument.vector(`short ${long}`, "")).toBe("'short':1A");
  });

  test("trigram stores the folded text itself, and no vector", () => {
    expect(PgSearchDocument.of({ label: "Café", body: "CRÈME brûlée" }, "trigram")).toEqual({
      document: null,
      label: "cafe",
      body: "creme brulee",
    });
  });
});

describe("PgSearchText", () => {
  test("words become one hand-written tsquery, every term required, the last a prefix", () => {
    const params = new PgParams();
    const text = PgSearchText.predicate(SearchTokens.parseQuery("Pricing NOT chan"), "unicode61", params)!;
    expect(params.values).toEqual(["'pricing' & 'not' & 'chan':*"]);
    expect(text.conds).toEqual(["d.document @@ $1::tsquery"]);
    expect(text.rank).toContain("ts_rank_cd");
  });

  test("text that ends on a separator has no prefix", () => {
    const params = new PgParams();
    PgSearchText.predicate(SearchTokens.parseQuery("pricing "), "unicode61", params);
    expect(params.values).toEqual(["'pricing'"]);
  });

  test("trigram tests each term as a substring of the label or the body", () => {
    const params = new PgParams();
    const text = PgSearchText.predicate(SearchTokens.parseQuery("go national"), "trigram", params)!;
    expect(params.values).toEqual(["%go%", "%national%"]);
    expect(text.conds).toHaveLength(2);
  });

  test("no text is a filter-only search, and an impossible term matches nothing", () => {
    expect(PgSearchText.predicate(SearchTokens.parseQuery(""), "unicode61", new PgParams())).toEqual({
      conds: [],
      rank: null,
    });
    const huge = SearchTokens.parseQuery("y".repeat(3000));
    expect(PgSearchText.predicate(huge, "unicode61", new PgParams())).toBeNull();
  });
});
