import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import { ScanSearcher } from "../../../src/core/search/scan-searcher";
import type { StorageTestContext } from "../storage-test-context";

/** The Query AST every adapter must answer identically: filters, sort, paging, and the portable search engine. */
export class QuerySuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);
    const getTitles = context.titles.bind(context);
    const seed = context.seed.bind(context);

    describe("queries", () => {
      test("Filters", async () => {
        const store = await getFreshStore();
        const { alpha } = await seed(store);

        const cases = [
          {
            name: "eq nested",
            filter: { op: "eq", path: "$.data.author.name", value: "nina" },
            want: ["alpha", "gamma"],
          },
          {
            name: "neq",
            filter: { op: "neq", path: "$.data.author.name", value: "nina" },
            want: ["beta"],
          },
          {
            name: "gt",
            filter: { op: "gt", path: "$.data.views", value: 5 },
            want: ["alpha", "beta"],
          },
          {
            name: "lte",
            filter: { op: "lte", path: "$.data.views", value: 10 },
            want: ["alpha", "gamma"],
          },
          {
            name: "in",
            filter: { op: "in", path: "$.data.title", value: ["alpha", "gamma"] },
            want: ["alpha", "gamma"],
          },
          {
            // Array membership is a wildcard path since D29, not `contains`.
            name: "membership via wildcard",
            filter: { op: "eq", path: "$.data.tags[*]", value: "go" },
            want: ["alpha", "beta"],
          },
          {
            // ...and `contains` no longer reaches into an array at all.
            name: "contains does not match an array",
            filter: { op: "contains", path: "$.data.tags", value: "go" },
            want: [],
          },
          {
            name: "contains substring",
            filter: { op: "contains", path: "$.data.title", value: "amm" },
            want: ["gamma"],
          },
          {
            name: "and",
            filter: {
              op: "and",
              args: [
                { op: "eq", path: "$.data.author.name", value: "nina" },
                { op: "gt", path: "$.data.views", value: 5 },
              ],
            },
            want: ["alpha"],
          },
          {
            name: "or",
            filter: {
              op: "or",
              args: [
                { op: "eq", path: "$.data.title", value: "beta" },
                { op: "eq", path: "$.data.title", value: "gamma" },
              ],
            },
            want: ["beta", "gamma"],
          },
          {
            name: "envelope id",
            filter: { op: "eq", path: "$.id", value: alpha.id },
            want: ["alpha"],
          },
          {
            name: "exists",
            filter: { op: "exists", path: "$.data.subtitle" },
            want: ["alpha"],
          },
          {
            name: "not exists",
            filter: { op: "not", args: [{ op: "exists", path: "$.data.subtitle" }] },
            want: ["beta", "gamma"],
          },
          {
            // The rule that changed: ANY over zero nodes is false, so `neq`
            // alone no longer matches an entry that lacks the field.
            name: "neq does not match a missing field",
            filter: { op: "neq", path: "$.data.subtitle", value: "first" },
            want: [],
          },
          {
            // ANY over zero nodes is false, so `neq` alone does not match a
            // missing field. This is the pre-D29 behaviour that changed, and the
            // spelling below is what replaces it.
            name: "absent or not equal",
            filter: {
              op: "or",
              args: [
                { op: "not", args: [{ op: "exists", path: "$.data.subtitle" }] },
                { op: "neq", path: "$.data.subtitle", value: "first" },
              ],
            },
            want: ["beta", "gamma"],
          },
          {
            name: "not over a comparison keeps rows whose field is missing",
            filter: { op: "not", args: [{ op: "gt", path: "$.data.missing", value: 5 }] },
            want: ["alpha", "beta", "gamma"],
          },
          {
            name: "wildcard into objects in an array",
            filter: { op: "eq", path: "$.data.blocks[*].kind", value: "quote" },
            want: ["gamma"],
          },
          {
            name: "index selector",
            filter: { op: "eq", path: "$.data.tags[0]", value: "go" },
            want: ["alpha", "beta"],
          },
          {
            name: "two wildcards nest",
            filter: { op: "eq", path: "$.data.matrix[*][*]", value: 3 },
            want: ["alpha"],
          },
          {
            name: "negative index selector",
            filter: { op: "eq", path: "$.data.tags[-1]", value: "db" },
            want: ["beta"],
          },
          {
            // A wildcard selects children of a container, never a scalar, so a
            // string `tags` must not match `$.data.tags[*]`.
            name: "wildcard does not select a scalar",
            filter: { op: "eq", path: "$.data.title[*]", value: "alpha" },
            want: [],
          },
        ];

        for (const tc of cases) {
          const { items, total } = await store.list(Scope.Default, "posts", {
            filter: tc.filter,
            sort: [{ path: "$.data.title", desc: false }],
            limit: 50,
            offset: 0,
          });
          const got = getTitles(items);
          expect(got).toEqual(tc.want);
          expect(total).toBe(tc.want.length);
        }
      });

      test("Sort", async () => {
        const store = await getFreshStore();
        await seed(store);

        const cases = [
          {
            name: "data field desc",
            sort: [{ path: "$.data.views", desc: true }],
            want: ["beta", "alpha", "gamma"],
          },
          {
            name: "two keys",
            sort: [
              { path: "$.data.author.name", desc: false },
              { path: "$.data.views", desc: true },
            ],
            want: ["alpha", "gamma", "beta"],
          },
          {
            name: "envelope desc",
            sort: [{ path: "$.created_at", desc: true }],
            want: ["gamma", "beta", "alpha"],
          },
        ];

        for (const tc of cases) {
          const { items } = await store.list(Scope.Default, "posts", {
            sort: tc.sort,
            limit: 50,
            offset: 0,
          });
          const got = getTitles(items);
          expect(got).toEqual(tc.want);
        }
      });

      // ScanSearcher is the portable engine (D30): it speaks only through the
      // `Storage` port, so proving it here proves it on every adapter at once —
      // which is the entire reason it ships before FTS5.
      test("Search (portable engine)", async () => {
        const store = await getFreshStore();
        await seed(store);
        const searcher = new ScanSearcher(store);
        const all = { targets: [{ project: "*", env: "*", collection: "*" }] };
        const run = (req: any) =>
          searcher.search({ limit: 50, offset: 0, ...req }, all);
        const titles = async (req: any) =>
          (await run(req)).items.map((h) => h.entry.data.title).sort();

        expect(await titles({ q: "alpha" })).toEqual(["alpha"]);
        // Text in a nested array of objects is indexed, not just top-level.
        expect(await titles({ q: "quote" })).toEqual(["gamma"]);
        // Every term must match; the last one matches as a prefix.
        expect(await titles({ q: "alpha nina" })).toEqual(["alpha"]);
        expect(await titles({ q: "alpha omar" })).toEqual([]);
        expect(await titles({ q: "nin" })).toEqual(["alpha", "gamma"]);
        // Field names never become terms.
        expect(await titles({ q: "subtitle" })).toEqual([]);

        // A filter composes with the text query, and a filter-only search works.
        expect(
          await titles({ q: "nina", filter: { op: "gt", path: "$.data.views", value: 5 } })
        ).toEqual(["alpha"]);
        expect(await titles({ filter: { op: "exists", path: "$.data.subtitle" } })).toEqual([
          "alpha",
        ]);

        const scoped = await searcher.search(
          { q: "nina", limit: 50, offset: 0 },
          { targets: [{ project: "nope", env: "*", collection: "*" }] }
        );
        expect(scoped.items).toEqual([]);
        expect(scoped.total).toBe(0);

        const hit = (await run({ q: "alpha" })).items[0];
        expect(hit.project).toBe(Scope.Default.project);
        expect(hit.env).toBe(Scope.Default.env);
        expect(hit.collection).toBe("posts");
        expect(hit.snippets.some((sn) => sn.match === "alpha")).toBe(true);

        // A visit cap reports itself rather than silently returning less.
        const capped = await new ScanSearcher(store, { visitLimit: 1 }).search(
          { q: "nina", limit: 50, offset: 0 },
          all
        );
        expect(capped.truncated).toBe(true);
      });

      test("Paging", async () => {
        const store = await getFreshStore();
        const scope = Scope.Default;
        for (let i = 0; i < 5; i++) {
          await putEntry(store, scope, "posts", i, { title: `p${i}`, n: i });
        }

        const p1 = await store.list(scope, "posts", {
          sort: [{ path: "$.data.n", desc: false }],
          limit: 2,
          offset: 0,
        });
        expect(p1.total).toBe(5);
        expect(getTitles(p1.items)).toEqual(["p0", "p1"]);

        const p2 = await store.list(scope, "posts", {
          sort: [{ path: "$.data.n", desc: false }],
          limit: 2,
          offset: 4,
        });
        expect(p2.total).toBe(5);
        expect(getTitles(p2.items)).toEqual(["p4"]);

        const empty = await store.list(scope, "empty", { limit: 50, offset: 0 });
        expect(empty.total).toBe(0);
        expect(empty.items.length).toBe(0);
      });
    });
  }
}
