import { describe, test, expect } from "bun:test";
import type { Storage } from "../../core/ports/storage";
import { EntryUtils } from "../../core/domain/entry-utils";
import type { Entry } from "../../core/domain/entry";
import { Scope } from "../../core/domain/scope";
import { ScanSearcher } from "../../core/search/scan-searcher";
import { MediaRefs } from "../../core/media/media-refs";
import { MediaRef } from "@silo/shared/media-ref";

export function runStorageTestSuite(
  name: string,
  open: () => Promise<Storage>,
  cleanup: (store: Storage) => Promise<void>
) {
  describe(`Storage Conformance: ${name}`, () => {
    let store: Storage;

    const getFreshStore = async () => {
      if (store) {
        await cleanup(store);
      }
      store = await open();
      return store;
    };

    const putEntry = async (
      st: Storage,
      scope: Scope,
      collection: string,
      sec: number,
      data: any
    ): Promise<Entry> => {
      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, sec));
      const e: Entry = {
        id: EntryUtils.newID(),
        project: scope.project,
        env: scope.env,
        collection,
        rev: 1,
        seq: 0,
        created_at: ts,
        updated_at: ts,
        data,
      };
      await st.put(e, MediaRefs.extract(e.data));
      return e;
    };

    const getTitles = (items: Entry[]): string[] => {
      return items.map((item) => item.data.title);
    };

    const seed = async (st: Storage, scope: Scope = Scope.Default) => {
      const alpha = await putEntry(st, scope, "posts", 1, {
        title: "alpha",
        views: 10,
        tags: ["go", "cms"],
        author: { name: "nina" },
        // Only alpha carries a subtitle, so the presence operators have
        // something to separate; only alpha is nested twice, so the wildcard
        // chain has something to recurse through.
        subtitle: "first",
        matrix: [[1, 2], [3]],
      });
      const beta = await putEntry(st, scope, "posts", 2, {
        title: "beta",
        views: 25,
        tags: ["go", "db"],
        author: { name: "omar" },
      });
      const gamma = await putEntry(st, scope, "posts", 3, {
        title: "gamma",
        views: 3,
        tags: [],
        author: { name: "nina" },
        blocks: [{ kind: "para" }, { kind: "quote" }],
      });
      return { alpha, beta, gamma };
    };

    test("SchemaCRUD", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      const s1 = { type: "object" };
      const s2 = { type: "object", required: ["title"] };

      await st.putSchema(scope, "posts", s1);
      let got = await st.getSchema(scope, "posts");
      expect(got).toEqual(s1);

      await st.putSchema(scope, "posts", s2);
      got = await st.getSchema(scope, "posts");
      expect(got).toEqual(s2);

      const all = await st.listSchemas(scope);
      expect(all.size).toBe(1);
      expect(all.get("posts")).toEqual(s2);

      await st.deleteSchema(scope, "posts");
      await expect(st.getSchema(scope, "posts")).rejects.toThrow();
      await expect(st.deleteSchema(scope, "posts")).rejects.toThrow();
    });

    test("EntryLifecycle", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      const e = await putEntry(st, scope, "posts", 1, { title: "alpha" });
      expect(e.seq).toBeGreaterThan(0);

      const got = await st.get(scope, "posts", e.id);
      expect(got.rev).toBe(1);
      expect(got.seq).toBe(e.seq);
      expect(got.project).toBe(scope.project);
      expect(got.env).toBe(scope.env);
      expect(got.data).toEqual(e.data);
      expect(got.created_at.toISOString()).toBe(e.created_at.toISOString());
      expect(got.updated_at.toISOString()).toBe(e.updated_at.toISOString());

      // Replace
      const upd = { ...got };
      upd.rev = 2;
      upd.data = { title: "alpha2" };
      await st.put(upd, MediaRefs.extract(upd.data));
      expect(upd.seq).toBeGreaterThan(e.seq);

      const got2 = await st.get(scope, "posts", e.id);
      expect(got2.rev).toBe(2);
      expect(got2.data).toEqual({ title: "alpha2" });

      await st.delete(scope, "posts", e.id);
      await expect(st.get(scope, "posts", e.id)).rejects.toThrow();
    });

    test("SeqMonotonic", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      const a = await putEntry(st, scope, "posts", 1, { title: "a" });
      const b = await putEntry(st, scope, "pages", 2, { title: "b" });
      const c = await putEntry(st, scope, "posts", 3, { title: "c" });

      expect(a.seq).toBeLessThan(b.seq);
      expect(b.seq).toBeLessThan(c.seq);

      const m = await st.meta();
      expect(m.last_seq).toBe(c.seq);
    });

    test("SeqMonotonicAcrossScopes", async () => {
      const st = await getFreshStore();
      const scopeA = Scope.of("a", "dev");
      const scopeB = Scope.of("b", "prod");

      const a1 = await putEntry(st, scopeA, "posts", 1, { title: "a1" });
      const b1 = await putEntry(st, scopeB, "posts", 2, { title: "b1" });
      const a2 = await putEntry(st, scopeA, "posts", 3, { title: "a2" });

      expect(a1.seq).toBeLessThan(b1.seq);
      expect(b1.seq).toBeLessThan(a2.seq);

      const m = await st.meta();
      expect(m.last_seq).toBe(a2.seq);
    });

    test("Filters", async () => {
      const st = await getFreshStore();
      const { alpha } = await seed(st);

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
        const { items, total } = await st.list(Scope.Default, "posts", {
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
      const st = await getFreshStore();
      await seed(st);

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
        const { items } = await st.list(Scope.Default, "posts", {
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
      const st = await getFreshStore();
      await seed(st);
      const searcher = new ScanSearcher(st);
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
      expect(hit.snippets.some((sn) => sn.text.includes("[alpha]"))).toBe(true);

      // A visit cap reports itself rather than silently returning less.
      const capped = await new ScanSearcher(st, { visitLimit: 1 }).search(
        { q: "nina", limit: 50, offset: 0 },
        all
      );
      expect(capped.truncated).toBe(true);
    });

    test("Paging", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      for (let i = 0; i < 5; i++) {
        await putEntry(st, scope, "posts", i, { title: `p${i}`, n: i });
      }

      const p1 = await st.list(scope, "posts", {
        sort: [{ path: "$.data.n", desc: false }],
        limit: 2,
        offset: 0,
      });
      expect(p1.total).toBe(5);
      expect(getTitles(p1.items)).toEqual(["p0", "p1"]);

      const p2 = await st.list(scope, "posts", {
        sort: [{ path: "$.data.n", desc: false }],
        limit: 2,
        offset: 4,
      });
      expect(p2.total).toBe(5);
      expect(getTitles(p2.items)).toEqual(["p4"]);

      const empty = await st.list(scope, "empty", { limit: 50, offset: 0 });
      expect(empty.total).toBe(0);
      expect(empty.items.length).toBe(0);
    });

    test("NotFound", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      await expect(st.get(scope, "posts", "01JMISSING")).rejects.toThrow();
      await expect(st.delete(scope, "posts", "01JMISSING")).rejects.toThrow();
      await expect(st.getSchema(scope, "nope")).rejects.toThrow();
    });

    // Entry-bearing collections are discovered independently of schemas: an
    // import archive can carry content/<collection>/ with nothing under
    // schemas/, and those entries are invisible to listSchemas().
    test("ListEntryCollections", async () => {
      const st = await getFreshStore();
      const a = Scope.of("acme", "prod");
      const b = Scope.of("acme", "dev");

      expect(await st.listEntryCollections(a)).toEqual([]);

      // A schema alone is not an entry-bearing collection.
      await st.putSchema(a, "schema-only", { type: "object" });
      expect(await st.listEntryCollections(a)).toEqual([]);

      await putEntry(st, a, "posts", 1, { title: "x" });
      await putEntry(st, a, "posts", 2, { title: "y" });
      await putEntry(st, a, "authors", 3, { title: "z" });
      await putEntry(st, b, "elsewhere", 4, { title: "w" });

      // Sorted, deduplicated, and scoped — b's collection must not leak in.
      expect(await st.listEntryCollections(a)).toEqual(["authors", "posts"]);
      expect(await st.listEntryCollections(b)).toEqual(["elsewhere"]);

      // Pruned once the last entry goes, matching listScopes()' rule that a
      // leftover directory is not content.
      const { items } = await st.list(a, "authors", { limit: 50, offset: 0 });
      for (const e of items) await st.delete(a, "authors", e.id);
      expect(await st.listEntryCollections(a)).toEqual(["posts"]);

      // System collections are reported like any other — the reserved scope
      // has no special-cased path in either adapter (D18).
      await putEntry(st, Scope.System, "_keys", 5, { hash: "h" });
      expect(await st.listEntryCollections(Scope.System)).toEqual(["_keys"]);
    });

    test("Meta", async () => {
      const st = await getFreshStore();
      const m1 = await st.meta();
      expect(m1.instance_id).not.toBe("");
      expect(m1.last_seq).toBe(0);

      await putEntry(st, Scope.Default, "posts", 1, { title: "x" });
      const m2 = await st.meta();
      expect(m2.instance_id).toBe(m1.instance_id);
      expect(m2.last_seq).toBe(1);
    });

    test("MultipleCollectionCoexistence", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      const qualified = "posts";
      const schema = { type: "object", required: ["title"] };

      // Schema CRUD under a qualified name
      await st.putSchema(scope, qualified, schema);
      expect(await st.getSchema(scope, qualified)).toEqual(schema);

      const all = await st.listSchemas(scope);
      expect(all.size).toBe(1);
      expect(all.has(qualified)).toBe(true);
      expect(all.get(qualified)).toEqual(schema);

      // A second collection coexists independently
      const other = "pages";
      await st.putSchema(scope, other, { type: "object" });
      const all2 = await st.listSchemas(scope);
      expect(all2.size).toBe(2);
      expect([...all2.keys()].sort()).toEqual([other, qualified].sort());

      // Entry CRUD + list/filter scoped to the name
      const a = await putEntry(st, scope, qualified, 1, { title: "alpha", views: 5 });
      const b = await putEntry(st, scope, qualified, 2, { title: "beta", views: 50 });
      await putEntry(st, scope, other, 3, { title: "unrelated" });

      const got = await st.get(scope, qualified, a.id);
      expect(got.collection).toBe(qualified);
      expect(got.data).toEqual(a.data);

      const listed = await st.list(scope, qualified, { limit: 50, offset: 0 });
      expect(listed.total).toBe(2);
      expect(getTitles(listed.items).sort()).toEqual(["alpha", "beta"]);

      const filtered = await st.list(scope, qualified, {
        filter: { op: "gt", path: "$.data.views", value: 10 },
        limit: 50,
        offset: 0,
      });
      expect(getTitles(filtered.items)).toEqual(["beta"]);

      await st.delete(scope, qualified, a.id);
      await expect(st.get(scope, qualified, a.id)).rejects.toThrow();
      const remaining = await st.list(scope, qualified, { limit: 50, offset: 0 });
      expect(remaining.total).toBe(1);
      expect(remaining.items[0].id).toBe(b.id);

      // The other collection is untouched
      const otherListed = await st.list(scope, other, { limit: 50, offset: 0 });
      expect(otherListed.total).toBe(1);

      await st.deleteSchema(scope, qualified);
      await expect(st.getSchema(scope, qualified)).rejects.toThrow();
      expect((await st.listSchemas(scope)).has(qualified)).toBe(false);
      expect((await st.listSchemas(scope)).has(other)).toBe(true);
    });

    test("ScopeIsolation", async () => {
      const st = await getFreshStore();
      const devA = Scope.of("a", "dev");
      const prodA = Scope.of("a", "prod");
      const devB = Scope.of("b", "dev");

      const schemaDev = { type: "object", required: ["title"] };
      const schemaProd = { type: "object" };

      await st.putSchema(devA, "posts", schemaDev);
      await st.putSchema(prodA, "posts", schemaProd);
      await st.putSchema(devB, "posts", schemaDev);

      // Same collection name, independent schemas per scope
      expect(await st.getSchema(devA, "posts")).toEqual(schemaDev);
      expect(await st.getSchema(prodA, "posts")).toEqual(schemaProd);
      expect(await st.getSchema(devB, "posts")).toEqual(schemaDev);

      const devAEntry = await putEntry(st, devA, "posts", 1, { title: "dev-a" });
      const prodAEntry = await putEntry(st, prodA, "posts", 2, { title: "prod-a" });
      const devBEntry = await putEntry(st, devB, "posts", 3, { title: "dev-b" });

      // get/list in one scope never sees another scope's entries
      expect((await st.get(devA, "posts", devAEntry.id)).data.title).toBe("dev-a");
      await expect(st.get(prodA, "posts", devAEntry.id)).rejects.toThrow();
      await expect(st.get(devB, "posts", devAEntry.id)).rejects.toThrow();

      const devAList = await st.list(devA, "posts", { limit: 50, offset: 0 });
      expect(devAList.total).toBe(1);
      expect(getTitles(devAList.items)).toEqual(["dev-a"]);

      const prodAList = await st.list(prodA, "posts", { limit: 50, offset: 0 });
      expect(prodAList.total).toBe(1);
      expect(getTitles(prodAList.items)).toEqual(["prod-a"]);

      const devBList = await st.list(devB, "posts", { limit: 50, offset: 0 });
      expect(devBList.total).toBe(1);
      expect(getTitles(devBList.items)).toEqual(["dev-b"]);

      // Deleting the collection (schema + entries) in one scope leaves the
      // same-named collection in another scope intact.
      await st.delete(devA, "posts", devAEntry.id);
      await st.deleteSchema(devA, "posts");
      await expect(st.getSchema(devA, "posts")).rejects.toThrow();
      expect((await st.list(devA, "posts", { limit: 50, offset: 0 })).total).toBe(0);

      expect(await st.getSchema(prodA, "posts")).toEqual(schemaProd);
      expect((await st.list(prodA, "posts", { limit: 50, offset: 0 })).total).toBe(1);
      expect(await st.getSchema(devB, "posts")).toEqual(schemaDev);
      expect((await st.list(devB, "posts", { limit: 50, offset: 0 })).total).toBe(1);
    });

    test("ListSchemasIsScopedToOneScope", async () => {
      const st = await getFreshStore();
      const scopeA = Scope.of("a", "dev");
      const scopeB = Scope.of("b", "prod");

      await st.putSchema(scopeA, "posts", { type: "object" });
      await st.putSchema(scopeA, "pages", { type: "object" });
      await st.putSchema(scopeB, "posts", { type: "object" });

      const aSchemas = await st.listSchemas(scopeA);
      expect(aSchemas.size).toBe(2);
      expect([...aSchemas.keys()].sort()).toEqual(["pages", "posts"]);

      const bSchemas = await st.listSchemas(scopeB);
      expect(bSchemas.size).toBe(1);
      expect([...bSchemas.keys()]).toEqual(["posts"]);
    });

    test("ListScopes", async () => {
      const st = await getFreshStore();
      const scopeA = Scope.of("a", "dev");
      const scopeB = Scope.of("a", "prod");
      const scopeC = Scope.of("z", "dev");

      // Written out of order to prove listScopes() sorts.
      await putEntry(st, scopeC, "posts", 1, { title: "c" });
      await st.putSchema(scopeA, "posts", { type: "object" });
      await putEntry(st, scopeB, "posts", 2, { title: "b" });

      // A write into the system scope must never surface in listScopes().
      await putEntry(st, Scope.System, "_keys", 3, { label: "root" });

      const scopes = await st.listScopes();
      expect(scopes.map((s) => s.key())).toEqual(["a/dev", "a/prod", "z/dev"]);
      expect(scopes.some((s) => s.isSystem())).toBe(false);

      // The system scope is invisible to listScopes() but still directly
      // readable via get(Scope.System, ...).
      const list = await st.list(Scope.System, "_keys", { limit: 50, offset: 0 });
      expect(list.total).toBe(1);
      expect(list.items[0].data.label).toBe("root");
    });

    test("ListScopesPrunesScopesWithNoRemainingContent", async () => {
      const st = await getFreshStore();
      const scope = Scope.of("acme", "dev");
      const other = Scope.of("acme", "prod");

      await st.putSchema(scope, "posts", { type: "object" });
      const e = await putEntry(st, scope, "posts", 1, { title: "x" });
      await st.putSchema(other, "posts", { type: "object" });

      expect((await st.listScopes()).map((s) => s.key()).sort()).toEqual(["acme/dev", "acme/prod"]);

      // Deleting every schema and entry in a scope must make listScopes()
      // stop reporting it — "exists" is derived from content, not from a
      // directory (fs) or a row that merely used to exist (D18).
      await st.delete(scope, "posts", e.id);
      await st.deleteSchema(scope, "posts");

      expect((await st.listScopes()).map((s) => s.key())).toEqual(["acme/prod"]);

      await st.deleteSchema(other, "posts");
      expect(await st.listScopes()).toEqual([]);
    });

    // ---- Projects and environments (D20) ----
    //
    // These six port methods carry the whole "does this scope exist" question,
    // and the two adapters answer it from completely different material —
    // rows in `projects`/`environments` on one side, directories on the
    // other. Anything only one of them gets right is a portability bug by
    // construction: an export enumerates `listScopes()`, so a scope one
    // adapter reports and the other doesn't is data that survives on SQLite
    // and vanishes on files.

    test("CreatedProjectIsListedBeforeItHoldsAnything", async () => {
      const st = await getFreshStore();

      await st.createProject("acme");
      expect(await st.listProjects()).toEqual(["acme"]);
      // A project with no env yet is not a scope — there is nothing to address.
      expect(await st.listEnvironments("acme")).toEqual([]);
      expect(await st.listScopes()).toEqual([]);

      await st.createEnvironment("acme", "dev");
      expect(await st.listEnvironments("acme")).toEqual(["dev"]);
      // The export-critical half: an env that was created but holds nothing
      // still exists, so `Exporter` can carry it across a round trip.
      expect((await st.listScopes()).map((sc) => sc.key())).toEqual(["acme/dev"]);
    });

    test("CreateIsIdempotentAndDeleteOfTheUnknownIsANoOp", async () => {
      const st = await getFreshStore();

      await st.createProject("acme");
      await st.createProject("acme");
      await st.createEnvironment("acme", "dev");
      await st.createEnvironment("acme", "dev");
      expect(await st.listProjects()).toEqual(["acme"]);
      expect(await st.listEnvironments("acme")).toEqual(["dev"]);

      await st.deleteProject("never-existed");
      await st.deleteEnvironment("acme", "never-existed");
      await st.deleteEnvironment("never-existed", "dev");
      expect(await st.listProjects()).toEqual(["acme"]);
      expect(await st.listEnvironments("acme")).toEqual(["dev"]);
    });

    test("ContentBringsAScopeIntoExistenceWithoutCreatingIt", async () => {
      const st = await getFreshStore();
      const scope = Scope.of("ghost", "prod");

      // An import or a direct put can write into a scope nobody created.
      await st.putSchema(scope, "posts", { type: "object" });
      expect(await st.listProjects()).toEqual(["ghost"]);
      expect(await st.listEnvironments("ghost")).toEqual(["prod"]);
      expect((await st.listScopes()).map((sc) => sc.key())).toEqual(["ghost/prod"]);

      // ...and it stops existing when that content goes, since nothing ever
      // recorded it explicitly. A scope that lingers here is one no API call
      // can remove.
      await st.deleteSchema(scope, "posts");
      expect(await st.listProjects()).toEqual([]);
      expect(await st.listEnvironments("ghost")).toEqual([]);
      expect(await st.listScopes()).toEqual([]);
    });

    test("ExplicitlyCreatedScopeOutlivesItsContent", async () => {
      const st = await getFreshStore();
      const scope = Scope.of("acme", "dev");

      await st.createEnvironment("acme", "dev");
      const e = await putEntry(st, scope, "posts", 1, { title: "x" });
      await st.putSchema(scope, "posts", { type: "object" });

      await st.delete(scope, "posts", e.id);
      await st.deleteSchema(scope, "posts");

      // Emptying a scope is not the same as deleting it.
      expect(await st.listProjects()).toEqual(["acme"]);
      expect(await st.listEnvironments("acme")).toEqual(["dev"]);
      expect((await st.listScopes()).map((sc) => sc.key())).toEqual(["acme/dev"]);
    });

    test("CreateEnvironmentImpliesItsProject", async () => {
      const st = await getFreshStore();
      await st.createEnvironment("acme", "dev");
      expect(await st.listProjects()).toEqual(["acme"]);
    });

    test("DeleteEnvironmentRemovesItsContentAndSparesItsSiblings", async () => {
      const st = await getFreshStore();
      const dev = Scope.of("acme", "dev");
      const prod = Scope.of("acme", "prod");

      await st.createEnvironment("acme", "dev");
      await st.createEnvironment("acme", "prod");
      await st.putSchema(dev, "posts", { type: "object" });
      await putEntry(st, dev, "posts", 1, { title: "dev" });
      await st.putSchema(prod, "posts", { type: "object" });
      await putEntry(st, prod, "posts", 2, { title: "prod" });

      await st.deleteEnvironment("acme", "dev");

      expect(await st.listEnvironments("acme")).toEqual(["prod"]);
      expect((await st.listScopes()).map((sc) => sc.key())).toEqual(["acme/prod"]);
      expect((await st.listSchemas(dev)).size).toBe(0);
      expect((await st.list(dev, "posts", { limit: 50, offset: 0 })).total).toBe(0);
      // The sibling is untouched, and the project outlives the env.
      expect((await st.listSchemas(prod)).size).toBe(1);
      expect((await st.list(prod, "posts", { limit: 50, offset: 0 })).total).toBe(1);
      expect(await st.listProjects()).toEqual(["acme"]);
    });

    test("DeleteProjectRemovesEveryEnvironmentBeneathIt", async () => {
      const st = await getFreshStore();
      const dev = Scope.of("acme", "dev");
      const prod = Scope.of("acme", "prod");
      const other = Scope.of("other", "prod");

      await st.createEnvironment("acme", "dev");
      await st.putSchema(dev, "posts", { type: "object" });
      await putEntry(st, dev, "posts", 1, { title: "dev" });
      await putEntry(st, prod, "posts", 2, { title: "prod" });
      await st.putSchema(other, "posts", { type: "object" });

      await st.deleteProject("acme");

      expect(await st.listProjects()).toEqual(["other"]);
      expect(await st.listEnvironments("acme")).toEqual([]);
      expect((await st.listScopes()).map((sc) => sc.key())).toEqual(["other/prod"]);
      expect((await st.listSchemas(dev)).size).toBe(0);
      expect((await st.list(prod, "posts", { limit: 50, offset: 0 })).total).toBe(0);
      expect((await st.listSchemas(other)).size).toBe(1);
    });

    test("SystemScopeIsNeverListedAsAProjectOrEnvironment", async () => {
      const st = await getFreshStore();

      await putEntry(st, Scope.System, "_keys", 1, { label: "root" });
      await st.createProject("acme");

      expect(await st.listProjects()).toEqual(["acme"]);
      expect(await st.listEnvironments(Scope.System.project)).toEqual([]);
      expect(await st.listScopes()).toEqual([]);
      // Still reachable directly — it is hidden from listings, not gone.
      expect((await st.list(Scope.System, "_keys", { limit: 50, offset: 0 })).total).toBe(1);
    });

    test("ListingsAreSorted", async () => {
      const st = await getFreshStore();
      for (const [project, env] of [["zulu", "prod"], ["alpha", "staging"], ["alpha", "dev"]]) {
        await st.createEnvironment(project, env);
      }
      expect(await st.listProjects()).toEqual(["alpha", "zulu"]);
      expect(await st.listEnvironments("alpha")).toEqual(["dev", "staging"]);
      expect((await st.listScopes()).map((sc) => sc.key())).toEqual([
        "alpha/dev",
        "alpha/staging",
        "zulu/prod",
      ]);
    });

    test("SameEntryIdAcrossScopesStaysDistinct", async () => {
      const st = await getFreshStore();
      const scopeA = Scope.of("a", "dev");
      const scopeB = Scope.of("b", "prod");
      const sharedId = EntryUtils.newID();

      await st.putSchema(scopeA, "posts", { type: "object" });
      await st.putSchema(scopeB, "posts", { type: "object" });

      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 1));
      const a: Entry = {
        id: sharedId, project: scopeA.project, env: scopeA.env, collection: "posts",
        rev: 1, seq: 0, created_at: ts, updated_at: ts, data: { title: "a" },
      };
      const b: Entry = {
        id: sharedId, project: scopeB.project, env: scopeB.env, collection: "posts",
        rev: 1, seq: 0, created_at: ts, updated_at: ts, data: { title: "b" },
      };
      await st.put(a, []);
      await st.put(b, []);

      // The identical id in two scopes must resolve to two independent
      // entries — this would still pass if a storage engine's primary key
      // (or on-disk path) accidentally dropped the scope columns/segments
      // and let the second put silently overwrite the first.
      expect((await st.get(scopeA, "posts", sharedId)).data.title).toBe("a");
      expect((await st.get(scopeB, "posts", sharedId)).data.title).toBe("b");

      await st.delete(scopeA, "posts", sharedId);
      await expect(st.get(scopeA, "posts", sharedId)).rejects.toThrow();
      // Deleting in one scope must not touch the other scope's entry of the
      // same id.
      expect((await st.get(scopeB, "posts", sharedId)).data.title).toBe("b");
    });

    test("RejectsUnsafeSegments", async () => {
      // A Storage port contract, not an fs-only defense: both adapters must
      // reject the same malformed collection/id/project/env identically.
      // This is what stands between an import archive's untrusted entry
      // `id` (taken from file contents, not the trusted archive path) and a
      // write that lands outside its scope — or, on fs, outside the data
      // dir entirely.
      const st = await getFreshStore();
      const scope = Scope.of("acme", "dev");
      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 1));
      // The length case matters as much as the traversal ones: a value the
      // fs adapter cannot turn into a filename (255-byte limit) must be
      // refused by BOTH adapters, or an archive imports on SQLite and dies
      // mid-write with a raw ENAMETOOLONG on fs.
      const unsafe = [
        "",
        ".",
        "..",
        "a/b",
        "../escape",
        "a\\b",
        "a\0b",
        "L".repeat(256),
        // 256 bytes as UTF-8 (128 two-byte chars) but only 128 characters —
        // a character-counting cap would wave this through.
        "é".repeat(128),
      ];

      const entryWith = (overrides: Partial<Entry>): Entry => ({
        id: EntryUtils.newID(),
        project: scope.project,
        env: scope.env,
        collection: "posts",
        rev: 1,
        seq: 0,
        created_at: ts,
        updated_at: ts,
        data: {},
        ...overrides,
      });

      for (const bad of unsafe) {
        await expect(st.put(entryWith({ id: bad }), [])).rejects.toThrow();
        await expect(st.put(entryWith({ collection: bad }), [])).rejects.toThrow();
        await expect(st.get(scope, bad, "someid")).rejects.toThrow();
        await expect(st.delete(scope, bad, "someid")).rejects.toThrow();
        await expect(st.list(scope, bad, { limit: 50, offset: 0 })).rejects.toThrow();
        await expect(st.get(scope, "posts", bad)).rejects.toThrow();
        await expect(st.delete(scope, "posts", bad)).rejects.toThrow();
      }

      await expect(st.put(entryWith({ project: "../evil" }), [])).rejects.toThrow();
      await expect(st.put(entryWith({ env: "../evil" }), [])).rejects.toThrow();

      // The store must still work normally after rejecting malformed input.
      const ok = await putEntry(st, scope, "posts", 2, { title: "fine" });
      expect((await st.get(scope, "posts", ok.id)).data.title).toBe("fine");
    });

    // ---- Media usages (D23) ----
    //
    // The one invariant that matters here is delete-while-referenced, and it
    // has to hold identically on both adapters even though they answer it by
    // completely different means: SQLite maintains a `media_references` table
    // inside its write transactions, the fs adapter keeps no index and scans.
    // A divergence would mean a media file that one backend refuses to delete
    // and the other silently orphans, which is exactly the class of bug this
    // suite exists to catch.

    describe("media usages", () => {
      const REF_A = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";
      const REF_B = "01J8XQ50P1R2S3T4U5V6W7X8Y9";

      const putWithRefs = async (
        st: Storage,
        scope: Scope,
        collection: string,
        refs: string[]
      ): Promise<Entry> => {
        const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 1));
        const e: Entry = {
          id: EntryUtils.newID(),
          project: scope.project,
          env: scope.env,
          collection,
          rev: 1,
          seq: 0,
          created_at: ts,
          updated_at: ts,
          // Stored as entry data holds them — `silo://media/<id>` — so the
          // extractor is exercised, not bypassed.
          data: {
            cover: MediaRef.url(refs[0]),
            gallery: refs.slice(1).map((r) => MediaRef.url(r)),
          },
        };
        await st.put(e, MediaRefs.extract(e.data));
        return e;
      };

      test("a written entry registers its references", async () => {
        const st = await getFreshStore();
        const e = await putWithRefs(st, Scope.Default, "posts", [REF_A, REF_B]);

        const usage = await st.listMediaUsages([REF_A]);
        expect(usage.total).toBe(1);
        expect(usage.items[0]).toMatchObject({
          media_id: REF_A,
          project: Scope.Default.project,
          env: Scope.Default.env,
          collection: "posts",
          entry_id: e.id,
        });

        const counts = await st.countMediaUsages([REF_A, REF_B]);
        expect(counts.get(REF_A)).toBe(1);
        expect(counts.get(REF_B)).toBe(1);

        expect((await st.listMediaUsages([])).total).toBe(0);
        expect((await st.listMediaUsages(["nobody-references-me"])).total).toBe(0);
      });

      test("rewriting an entry replaces its reference set wholesale", async () => {
        const st = await getFreshStore();
        const e = await putWithRefs(st, Scope.Default, "posts", [REF_A]);

        const moved: Entry = { ...e, rev: 2, data: { cover: MediaRef.url(REF_B) } };
        await st.put(moved, MediaRefs.extract(moved.data));

        // The old reference must be gone, not merely joined by the new one —
        // an accumulating index would keep REF_A blocked forever.
        expect((await st.listMediaUsages([REF_A])).total).toBe(0);
        expect((await st.listMediaUsages([REF_B])).total).toBe(1);
      });

      test("deleting an entry drops its references", async () => {
        const st = await getFreshStore();
        const e = await putWithRefs(st, Scope.Default, "posts", [REF_A]);

        await st.delete(Scope.Default, "posts", e.id);
        expect((await st.listMediaUsages([REF_A])).total).toBe(0);
      });

      test("deleting a scope drops the references its entries held", async () => {
        const st = await getFreshStore();
        const scope = Scope.of("acme", "prod");
        await st.createEnvironment(scope.project, scope.env);
        await putWithRefs(st, scope, "posts", [REF_A]);
        await putWithRefs(st, Scope.Default, "posts", [REF_A]);
        expect((await st.listMediaUsages([REF_A])).total).toBe(2);

        // The bulk path: SQLite deletes these rows with one statement and
        // never calls `delete` per entry, which is why this cleanup cannot
        // live above the port.
        await st.deleteEnvironment(scope.project, scope.env);
        expect((await st.listMediaUsages([REF_A])).total).toBe(1);

        await st.deleteProject(Scope.Default.project);
        expect((await st.listMediaUsages([REF_A])).total).toBe(0);
      });

      test("usages are counted across scopes and collections, and page", async () => {
        const st = await getFreshStore();
        const other = Scope.of("acme", "prod");
        await st.createEnvironment(other.project, other.env);

        await putWithRefs(st, Scope.Default, "posts", [REF_A]);
        await putWithRefs(st, Scope.Default, "pages", [REF_A]);
        await putWithRefs(st, other, "posts", [REF_A]);

        const all = await st.listMediaUsages([REF_A], { limit: 100 });
        expect(all.total).toBe(3);
        expect(all.items.length).toBe(3);

        const page = await st.listMediaUsages([REF_A], { limit: 2, offset: 0 });
        expect(page.total).toBe(3);
        expect(page.items.length).toBe(2);

        const rest = await st.listMediaUsages([REF_A], { limit: 2, offset: 2 });
        expect(rest.items.length).toBe(1);

        // A count-only probe — what the delete guard asks for.
        expect((await st.listMediaUsages([REF_A], { limit: 0 })).total).toBe(3);
      });

      test("references in system collections count too", async () => {
        const st = await getFreshStore();
        await putWithRefs(st, Scope.System, "_media_probe", [REF_A]);
        expect((await st.listMediaUsages([REF_A])).total).toBe(1);
      });
    });
  });
}
