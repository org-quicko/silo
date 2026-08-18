import { describe, test, expect } from "bun:test";
import type { Storage } from "../../core/ports/storage";
import { EntryUtils } from "../../core/domain/entry-utils";
import type { Entry } from "../../core/domain/entry";
import { Scope } from "../../core/domain/scope";

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
      await st.put(e);
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
      });
      const beta = await putEntry(st, scope, "posts", 2, {
        title: "beta",
        views: 25,
        tags: ["go"],
        author: { name: "omar" },
      });
      const gamma = await putEntry(st, scope, "posts", 3, {
        title: "gamma",
        views: 3,
        tags: [],
        author: { name: "nina" },
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
      await st.put(upd);
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
          filter: { op: "eq", field: "author.name", value: "nina" },
          want: ["alpha", "gamma"],
        },
        {
          name: "neq",
          filter: { op: "neq", field: "author.name", value: "nina" },
          want: ["beta"],
        },
        {
          name: "gt",
          filter: { op: "gt", field: "views", value: 5 },
          want: ["alpha", "beta"],
        },
        {
          name: "lte",
          filter: { op: "lte", field: "views", value: 10 },
          want: ["alpha", "gamma"],
        },
        {
          name: "in",
          filter: { op: "in", field: "title", value: ["alpha", "gamma"] },
          want: ["alpha", "gamma"],
        },
        {
          name: "contains array",
          filter: { op: "contains", field: "tags", value: "go" },
          want: ["alpha", "beta"],
        },
        {
          name: "contains substring",
          filter: { op: "contains", field: "title", value: "amm" },
          want: ["gamma"],
        },
        {
          name: "and",
          filter: {
            op: "and",
            args: [
              { op: "eq", field: "author.name", value: "nina" },
              { op: "gt", field: "views", value: 5 },
            ],
          },
          want: ["alpha"],
        },
        {
          name: "or",
          filter: {
            op: "or",
            args: [
              { op: "eq", field: "title", value: "beta" },
              { op: "eq", field: "title", value: "gamma" },
            ],
          },
          want: ["beta", "gamma"],
        },
        {
          name: "envelope id",
          filter: { op: "eq", field: "$id", value: alpha.id },
          want: ["alpha"],
        },
        {
          name: "envelope seq",
          filter: { op: "gt", field: "$seq", value: alpha.seq },
          want: ["beta", "gamma"],
        },
      ];

      for (const tc of cases) {
        const { items, total } = await st.list(Scope.Default, "posts", {
          filter: tc.filter,
          sort: [{ field: "title", desc: false }],
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
          sort: [{ field: "views", desc: true }],
          want: ["beta", "alpha", "gamma"],
        },
        {
          name: "two keys",
          sort: [
            { field: "author.name", desc: false },
            { field: "views", desc: true },
          ],
          want: ["alpha", "gamma", "beta"],
        },
        {
          name: "envelope desc",
          sort: [{ field: "$created_at", desc: true }],
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

    test("Paging", async () => {
      const st = await getFreshStore();
      const scope = Scope.Default;
      for (let i = 0; i < 5; i++) {
        await putEntry(st, scope, "posts", i, { title: `p${i}`, n: i });
      }

      const p1 = await st.list(scope, "posts", {
        sort: [{ field: "n", desc: false }],
        limit: 2,
        offset: 0,
      });
      expect(p1.total).toBe(5);
      expect(getTitles(p1.items)).toEqual(["p0", "p1"]);

      const p2 = await st.list(scope, "posts", {
        sort: [{ field: "n", desc: false }],
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
        filter: { op: "gt", field: "views", value: 10 },
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
      await st.put(a);
      await st.put(b);

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
        await expect(st.put(entryWith({ id: bad }))).rejects.toThrow();
        await expect(st.put(entryWith({ collection: bad }))).rejects.toThrow();
        await expect(st.get(scope, bad, "someid")).rejects.toThrow();
        await expect(st.delete(scope, bad, "someid")).rejects.toThrow();
        await expect(st.list(scope, bad, { limit: 50, offset: 0 })).rejects.toThrow();
        await expect(st.get(scope, "posts", bad)).rejects.toThrow();
        await expect(st.delete(scope, "posts", bad)).rejects.toThrow();
      }

      await expect(st.put(entryWith({ project: "../evil" }))).rejects.toThrow();
      await expect(st.put(entryWith({ env: "../evil" }))).rejects.toThrow();

      // The store must still work normally after rejecting malformed input.
      const ok = await putEntry(st, scope, "posts", 2, { title: "fine" });
      expect((await st.get(scope, "posts", ok.id)).data.title).toBe("fine");
    });
  });
}
