import { describe, expect, test } from "bun:test";
import { QueryString } from "../../src/transport/query-string";

describe("QueryString", () => {
  test("returns an empty string for undefined", () => {
    expect(QueryString.build(undefined)).toBe("");
  });

  test("returns an empty string when every value is omitted", () => {
    expect(QueryString.build({ a: undefined, b: null as unknown as undefined })).toBe("");
  });

  test("builds a plain string, number and boolean query", () => {
    expect(QueryString.build({ limit: 20, offset: 0, recursive: true })).toBe("?limit=20&offset=0&recursive=true");
  });

  test("omits undefined and null but keeps the rest", () => {
    expect(QueryString.build({ a: "x", b: undefined, c: null as unknown as undefined, d: 1 })).toBe("?a=x&d=1");
  });

  test("JSON-encodes and URL-encodes an object value", () => {
    const filter = { op: "eq", path: "$.data.status", value: "published" };
    const result = QueryString.build({ filter });

    expect(result).toBe(`?filter=${encodeURIComponent(JSON.stringify(filter))}`);
  });

  test("URL-encodes keys and plain values that need it", () => {
    expect(QueryString.build({ q: "a b/c" })).toBe("?q=a%20b%2Fc");
  });
});
