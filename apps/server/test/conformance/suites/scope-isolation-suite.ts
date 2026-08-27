import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { Entry } from "../../../src/core/domain/entry";
import { EntryUtils } from "../../../src/core/domain/entry-utils";
import type { StorageTestContext } from "../storage-test-context";

/** Collections and entries in one scope stay invisible to another, including when they share a name or an id. */
export class ScopeIsolationSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);
    const getTitles = context.titles.bind(context);

    describe("scope isolation", () => {
      test("MultipleCollectionCoexistence", async () => {
        const store = await getFreshStore();
        const scope = Scope.Default;
        const qualified = "posts";
        const schema = { type: "object", required: ["title"] };

        // Schema CRUD under a qualified name
        await store.putSchema(scope, qualified, schema);
        expect(await store.getSchema(scope, qualified)).toEqual(schema);

        const all = await store.listSchemas(scope);
        expect(all.size).toBe(1);
        expect(all.has(qualified)).toBe(true);
        expect(all.get(qualified)).toEqual(schema);

        // A second collection coexists independently
        const other = "pages";
        await store.putSchema(scope, other, { type: "object" });
        const all2 = await store.listSchemas(scope);
        expect(all2.size).toBe(2);
        expect([...all2.keys()].sort()).toEqual([other, qualified].sort());

        // Entry CRUD + list/filter scoped to the name
        const a = await putEntry(store, scope, qualified, 1, { title: "alpha", views: 5 });
        const b = await putEntry(store, scope, qualified, 2, { title: "beta", views: 50 });
        await putEntry(store, scope, other, 3, { title: "unrelated" });

        const got = await store.get(scope, qualified, a.id);
        expect(got.collection).toBe(qualified);
        expect(got.data).toEqual(a.data);

        const listed = await store.list(scope, qualified, { limit: 50, offset: 0 });
        expect(listed.total).toBe(2);
        expect(getTitles(listed.items).sort()).toEqual(["alpha", "beta"]);

        const filtered = await store.list(scope, qualified, {
          filter: { op: "gt", path: "$.data.views", value: 10 },
          limit: 50,
          offset: 0,
        });
        expect(getTitles(filtered.items)).toEqual(["beta"]);

        await store.delete(scope, qualified, a.id);
        await expect(store.get(scope, qualified, a.id)).rejects.toThrow();
        const remaining = await store.list(scope, qualified, { limit: 50, offset: 0 });
        expect(remaining.total).toBe(1);
        expect(remaining.items[0].id).toBe(b.id);

        // The other collection is untouched
        const otherListed = await store.list(scope, other, { limit: 50, offset: 0 });
        expect(otherListed.total).toBe(1);

        await store.deleteSchema(scope, qualified);
        await expect(store.getSchema(scope, qualified)).rejects.toThrow();
        expect((await store.listSchemas(scope)).has(qualified)).toBe(false);
        expect((await store.listSchemas(scope)).has(other)).toBe(true);
      });

      test("ScopeIsolation", async () => {
        const store = await getFreshStore();
        const devA = Scope.of("a", "dev");
        const prodA = Scope.of("a", "prod");
        const devB = Scope.of("b", "dev");

        const schemaDev = { type: "object", required: ["title"] };
        const schemaProd = { type: "object" };

        await store.putSchema(devA, "posts", schemaDev);
        await store.putSchema(prodA, "posts", schemaProd);
        await store.putSchema(devB, "posts", schemaDev);

        // Same collection name, independent schemas per scope
        expect(await store.getSchema(devA, "posts")).toEqual(schemaDev);
        expect(await store.getSchema(prodA, "posts")).toEqual(schemaProd);
        expect(await store.getSchema(devB, "posts")).toEqual(schemaDev);

        const devAEntry = await putEntry(store, devA, "posts", 1, { title: "dev-a" });
        const prodAEntry = await putEntry(store, prodA, "posts", 2, { title: "prod-a" });
        const devBEntry = await putEntry(store, devB, "posts", 3, { title: "dev-b" });

        // get/list in one scope never sees another scope's entries
        expect((await store.get(devA, "posts", devAEntry.id)).data.title).toBe("dev-a");
        await expect(store.get(prodA, "posts", devAEntry.id)).rejects.toThrow();
        await expect(store.get(devB, "posts", devAEntry.id)).rejects.toThrow();

        const devAList = await store.list(devA, "posts", { limit: 50, offset: 0 });
        expect(devAList.total).toBe(1);
        expect(getTitles(devAList.items)).toEqual(["dev-a"]);

        const prodAList = await store.list(prodA, "posts", { limit: 50, offset: 0 });
        expect(prodAList.total).toBe(1);
        expect(getTitles(prodAList.items)).toEqual(["prod-a"]);

        const devBList = await store.list(devB, "posts", { limit: 50, offset: 0 });
        expect(devBList.total).toBe(1);
        expect(getTitles(devBList.items)).toEqual(["dev-b"]);

        // Deleting the collection (schema + entries) in one scope leaves the
        // same-named collection in another scope intact.
        await store.delete(devA, "posts", devAEntry.id);
        await store.deleteSchema(devA, "posts");
        await expect(store.getSchema(devA, "posts")).rejects.toThrow();
        expect((await store.list(devA, "posts", { limit: 50, offset: 0 })).total).toBe(0);

        expect(await store.getSchema(prodA, "posts")).toEqual(schemaProd);
        expect((await store.list(prodA, "posts", { limit: 50, offset: 0 })).total).toBe(1);
        expect(await store.getSchema(devB, "posts")).toEqual(schemaDev);
        expect((await store.list(devB, "posts", { limit: 50, offset: 0 })).total).toBe(1);
      });

      test("ListingsAreSorted", async () => {
        const store = await getFreshStore();
        for (const [project, env] of [["zulu", "prod"], ["alpha", "staging"], ["alpha", "dev"]]) {
          await store.createEnvironment(project, env);
        }
        expect(await store.listProjects()).toEqual(["alpha", "zulu"]);
        expect(await store.listEnvironments("alpha")).toEqual(["dev", "staging"]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual([
          "alpha/dev",
          "alpha/staging",
          "zulu/prod",
        ]);
      });

      test("SameEntryIdAcrossScopesStaysDistinct", async () => {
        const store = await getFreshStore();
        const scopeA = Scope.of("a", "dev");
        const scopeB = Scope.of("b", "prod");
        const sharedId = EntryUtils.newID();

        await store.putSchema(scopeA, "posts", { type: "object" });
        await store.putSchema(scopeB, "posts", { type: "object" });

        const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 1));
        const a: Entry = {
          id: sharedId, project: scopeA.project, env: scopeA.env, collection: "posts",
          rev: 1, seq: 0, created_at: ts, updated_at: ts, data: { title: "a" },
        };
        const b: Entry = {
          id: sharedId, project: scopeB.project, env: scopeB.env, collection: "posts",
          rev: 1, seq: 0, created_at: ts, updated_at: ts, data: { title: "b" },
        };
        await store.put(a, { usages: [], search: null });
        await store.put(b, { usages: [], search: null });

        // The identical id in two scopes must resolve to two independent
        // entries — this would still pass if a storage engine's primary key
        // (or on-disk path) accidentally dropped the scope columns/segments
        // and let the second put silently overwrite the first.
        expect((await store.get(scopeA, "posts", sharedId)).data.title).toBe("a");
        expect((await store.get(scopeB, "posts", sharedId)).data.title).toBe("b");

        await store.delete(scopeA, "posts", sharedId);
        await expect(store.get(scopeA, "posts", sharedId)).rejects.toThrow();
        // Deleting in one scope must not touch the other scope's entry of the
        // same id.
        expect((await store.get(scopeB, "posts", sharedId)).data.title).toBe("b");
      });
    });
  }
}
