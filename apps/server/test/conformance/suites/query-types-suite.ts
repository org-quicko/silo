import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { StorageTestContext } from "../storage-test-context";

/**
 * How a filter and a sort treat JSON types and strings (D92): strict equality,
 * comparisons only within a type, codepoint order, and one ranking across
 * types. SQLite coerced all of these and the fs adapter did not, so each case
 * here is one the two used to answer differently.
 */
export class QueryTypesSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);
    const getTitles = context.titles.bind(context);

    /** One entry per value, titled so the expected lists read in order. */
    const seedValues = async (values: Record<string, any>) => {
      const store = await getFreshStore();
      let second = 1;
      for (const [title, value] of Object.entries(values)) {
        const data = value === undefined ? { title } : { title, v: value };
        await putEntry(store, Scope.Default, "posts", second++, data);
      }
      return store;
    };

    const matching = async (store: any, filter: any) => {
      const { items, total } = await store.list(Scope.Default, "posts", {
        filter,
        sort: [{ path: "$.data.title", desc: false }],
        limit: 50,
        offset: 0,
      });
      expect(total).toBe(items.length);
      return getTitles(items);
    };

    describe("query types", () => {
      test("EqualityIsTypeStrict", async () => {
        const store = await seedValues({
          one: 1,
          yes: true,
          no: false,
          nothing: null,
          text: "1",
          object: { b: 1 },
          missing: undefined,
        });
        const eq = (value: any) => matching(store, { op: "eq", path: "$.data.v", value });

        expect(await eq(true)).toEqual(["yes"]);
        expect(await eq(1)).toEqual(["one"]);
        expect(await eq("1")).toEqual(["text"]);
        expect(await eq(null)).toEqual(["nothing"]);
        expect(await eq('{"b":1}')).toEqual([]);

        expect(await matching(store, { op: "in", path: "$.data.v", value: [null, false] })).toEqual(
          ["no", "nothing"]
        );
        expect(await matching(store, { op: "in", path: "$.data.v", value: [1, "1"] })).toEqual([
          "one",
          "text",
        ]);
        // Present and different: a missing field is never "not equal".
        expect(await matching(store, { op: "neq", path: "$.data.v", value: 1 })).toEqual([
          "no",
          "nothing",
          "object",
          "text",
          "yes",
        ]);
        expect(await matching(store, { op: "eq", path: "$.rev", value: "1" })).toEqual([]);
        expect((await matching(store, { op: "eq", path: "$.rev", value: 1 })).length).toBe(7);
      });

      test("ComparisonsStayWithinOneType", async () => {
        const store = await seedValues({
          three: 3,
          word: "x",
          yes: true,
          object: { b: 1 },
          big: "\u{1F600}",
          replacement: "�",
        });
        const compare = (op: string, value: any) => matching(store, { op, path: "$.data.v", value });

        expect(await compare("gt", 0)).toEqual(["three"]);
        expect(await compare("lt", "zzz")).toEqual(["word"]);
        expect(await compare("gte", true)).toEqual([]);
        expect(await compare("gt", null)).toEqual([]);
        // Codepoint order: U+1F600 sorts after U+FFFD, though its first UTF-16
        // code unit (0xD83D) is smaller.
        expect(await compare("gt", "�")).toEqual(["big"]);
        expect(await compare("lt", "\u{1F600}")).toEqual(["replacement", "word"]);
      });

      test("ContainsMatchesStringsOnly", async () => {
        const store = await seedValues({ word: "abc", empty: "", number: 12, object: { a: "b" } });
        const contains = (value: any) =>
          matching(store, { op: "contains", path: "$.data.v", value });

        expect(await contains("")).toEqual(["empty", "word"]);
        expect(await contains("b")).toEqual(["word"]);
        expect(await contains("a")).toEqual(["word"]);
      });

      test("SortUsesCodepointOrder", async () => {
        const store = await seedValues({
          lower: "a",
          upper: "B",
          accented: "é",
          replacement: "�",
          emoji: "\u{1F600}",
        });
        const sorted = async (desc: boolean) =>
          getTitles(
            (
              await store.list(Scope.Default, "posts", {
                sort: [{ path: "$.data.v", desc }],
                limit: 50,
                offset: 0,
              })
            ).items
          );

        expect(await sorted(false)).toEqual(["upper", "lower", "accented", "replacement", "emoji"]);
        expect(await sorted(true)).toEqual(["emoji", "replacement", "accented", "lower", "upper"]);
      });

      test("SortRanksTypes", async () => {
        const store = await seedValues({
          a: undefined,
          b: null,
          c: 10,
          d: 2,
          e: "x",
          f: "Y",
          g: true,
          h: false,
          i: [1],
          j: { k: 1 },
          k: [0],
        });
        const sorted = async (desc: boolean) =>
          getTitles(
            (
              await store.list(Scope.Default, "posts", {
                // Titles break the ties: missing and null rank together, and
                // arrays and objects tie within their type.
                sort: [
                  { path: "$.data.v", desc },
                  { path: "$.data.title", desc: false },
                ],
                limit: 50,
                offset: 0,
              })
            ).items
          );

        expect(await sorted(false)).toEqual(["a", "b", "d", "c", "f", "e", "h", "g", "i", "k", "j"]);
        expect(await sorted(true)).toEqual(["j", "i", "k", "g", "h", "e", "f", "c", "d", "a", "b"]);
      });
    });
  }
}
