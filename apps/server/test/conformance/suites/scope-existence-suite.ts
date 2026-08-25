import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { StorageTestContext } from "../storage-test-context";

/** D20's rule in both adapters: a scope exists when it was created explicitly *or* still holds content — and stops existing only when neither is true. */
export class ScopeExistenceSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);

    describe("scope existence", () => {
      test("ListScopes", async () => {
        const store = await getFreshStore();
        const scopeA = Scope.of("a", "dev");
        const scopeB = Scope.of("a", "prod");
        const scopeC = Scope.of("z", "dev");

        // Written out of order to prove listScopes() sorts.
        await putEntry(store, scopeC, "posts", 1, { title: "c" });
        await store.putSchema(scopeA, "posts", { type: "object" });
        await putEntry(store, scopeB, "posts", 2, { title: "b" });

        // A write into the system scope must never surface in listScopes().
        await putEntry(store, Scope.System, "_keys", 3, { label: "root" });

        const scopes = await store.listScopes();
        expect(scopes.map((s) => s.key())).toEqual(["a/dev", "a/prod", "z/dev"]);
        expect(scopes.some((s) => s.isSystem())).toBe(false);

        // The system scope is invisible to listScopes() but still directly
        // readable via get(Scope.System, ...).
        const list = await store.list(Scope.System, "_keys", { limit: 50, offset: 0 });
        expect(list.total).toBe(1);
        expect(list.items[0].data.label).toBe("root");
      });

      test("ListScopesPrunesScopesWithNoRemainingContent", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "dev");
        const other = Scope.of("acme", "prod");

        await store.putSchema(scope, "posts", { type: "object" });
        const e = await putEntry(store, scope, "posts", 1, { title: "x" });
        await store.putSchema(other, "posts", { type: "object" });

        expect((await store.listScopes()).map((s) => s.key()).sort()).toEqual(["acme/dev", "acme/prod"]);

        // Deleting every schema and entry in a scope must make listScopes()
        // stop reporting it — "exists" is derived from content, not from a
        // directory (fs) or a row that merely used to exist (D18).
        await store.delete(scope, "posts", e.id);
        await store.deleteSchema(scope, "posts");

        expect((await store.listScopes()).map((s) => s.key())).toEqual(["acme/prod"]);

        await store.deleteSchema(other, "posts");
        expect(await store.listScopes()).toEqual([]);
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
        const store = await getFreshStore();

        await store.createProject("acme");
        expect(await store.listProjects()).toEqual(["acme"]);
        // A project with no env yet is not a scope — there is nothing to address.
        expect(await store.listEnvironments("acme")).toEqual([]);
        expect(await store.listScopes()).toEqual([]);

        await store.createEnvironment("acme", "dev");
        expect(await store.listEnvironments("acme")).toEqual(["dev"]);
        // The export-critical half: an env that was created but holds nothing
        // still exists, so `Exporter` can carry it across a round trip.
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["acme/dev"]);
      });

      test("CreateIsIdempotentAndDeleteOfTheUnknownIsANoOp", async () => {
        const store = await getFreshStore();

        await store.createProject("acme");
        await store.createProject("acme");
        await store.createEnvironment("acme", "dev");
        await store.createEnvironment("acme", "dev");
        expect(await store.listProjects()).toEqual(["acme"]);
        expect(await store.listEnvironments("acme")).toEqual(["dev"]);

        await store.deleteProject("never-existed");
        await store.deleteEnvironment("acme", "never-existed");
        await store.deleteEnvironment("never-existed", "dev");
        expect(await store.listProjects()).toEqual(["acme"]);
        expect(await store.listEnvironments("acme")).toEqual(["dev"]);
      });

      test("ContentBringsAScopeIntoExistenceWithoutCreatingIt", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("ghost", "prod");

        // An import or a direct put can write into a scope nobody created.
        await store.putSchema(scope, "posts", { type: "object" });
        expect(await store.listProjects()).toEqual(["ghost"]);
        expect(await store.listEnvironments("ghost")).toEqual(["prod"]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["ghost/prod"]);

        // ...and it stops existing when that content goes, since nothing ever
        // recorded it explicitly. A scope that lingers here is one no API call
        // can remove.
        await store.deleteSchema(scope, "posts");
        expect(await store.listProjects()).toEqual([]);
        expect(await store.listEnvironments("ghost")).toEqual([]);
        expect(await store.listScopes()).toEqual([]);
      });

      test("ExplicitlyCreatedScopeOutlivesItsContent", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "dev");

        await store.createEnvironment("acme", "dev");
        const e = await putEntry(store, scope, "posts", 1, { title: "x" });
        await store.putSchema(scope, "posts", { type: "object" });

        await store.delete(scope, "posts", e.id);
        await store.deleteSchema(scope, "posts");

        // Emptying a scope is not the same as deleting it.
        expect(await store.listProjects()).toEqual(["acme"]);
        expect(await store.listEnvironments("acme")).toEqual(["dev"]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["acme/dev"]);
      });

      test("CreateEnvironmentImpliesItsProject", async () => {
        const store = await getFreshStore();
        await store.createEnvironment("acme", "dev");
        expect(await store.listProjects()).toEqual(["acme"]);
      });

      test("DeleteEnvironmentRemovesItsContentAndSparesItsSiblings", async () => {
        const store = await getFreshStore();
        const dev = Scope.of("acme", "dev");
        const prod = Scope.of("acme", "prod");

        await store.createEnvironment("acme", "dev");
        await store.createEnvironment("acme", "prod");
        await store.putSchema(dev, "posts", { type: "object" });
        await putEntry(store, dev, "posts", 1, { title: "dev" });
        await store.putSchema(prod, "posts", { type: "object" });
        await putEntry(store, prod, "posts", 2, { title: "prod" });

        await store.deleteEnvironment("acme", "dev");

        expect(await store.listEnvironments("acme")).toEqual(["prod"]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["acme/prod"]);
        expect((await store.listSchemas(dev)).size).toBe(0);
        expect((await store.list(dev, "posts", { limit: 50, offset: 0 })).total).toBe(0);
        // The sibling is untouched, and the project outlives the env.
        expect((await store.listSchemas(prod)).size).toBe(1);
        expect((await store.list(prod, "posts", { limit: 50, offset: 0 })).total).toBe(1);
        expect(await store.listProjects()).toEqual(["acme"]);
      });

      test("DeleteProjectRemovesEveryEnvironmentBeneathIt", async () => {
        const store = await getFreshStore();
        const dev = Scope.of("acme", "dev");
        const prod = Scope.of("acme", "prod");
        const other = Scope.of("other", "prod");

        await store.createEnvironment("acme", "dev");
        await store.putSchema(dev, "posts", { type: "object" });
        await putEntry(store, dev, "posts", 1, { title: "dev" });
        await putEntry(store, prod, "posts", 2, { title: "prod" });
        await store.putSchema(other, "posts", { type: "object" });

        await store.deleteProject("acme");

        expect(await store.listProjects()).toEqual(["other"]);
        expect(await store.listEnvironments("acme")).toEqual([]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["other/prod"]);
        expect((await store.listSchemas(dev)).size).toBe(0);
        expect((await store.list(prod, "posts", { limit: 50, offset: 0 })).total).toBe(0);
        expect((await store.listSchemas(other)).size).toBe(1);
      });

      test("SystemScopeIsNeverListedAsAProjectOrEnvironment", async () => {
        const store = await getFreshStore();

        await putEntry(store, Scope.System, "_keys", 1, { label: "root" });
        await store.createProject("acme");

        expect(await store.listProjects()).toEqual(["acme"]);
        expect(await store.listEnvironments(Scope.System.project)).toEqual([]);
        expect(await store.listScopes()).toEqual([]);
        // Still reachable directly — it is hidden from listings, not gone.
        expect((await store.list(Scope.System, "_keys", { limit: 50, offset: 0 })).total).toBe(1);
      });
    });
  }
}
