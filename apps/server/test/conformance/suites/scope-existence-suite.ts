import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import { CollectionSchemas } from "../../../src/core/schema/collection-schemas";
import type { StorageTestContext } from "../storage-test-context";

/**
 * D51's rule in both adapters: a project, environment or collection exists
 * exactly when its **record** exists.
 *
 * This supersedes D20, where a scope existed if it had been created *or* still
 * held content. That reading has no answer to "what is this scope's id", and it
 * is no longer reachable either: a child references its parent by id, so content
 * cannot imply a parent that has no record.
 */
export class ScopeExistenceSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);
    const names = async (records: Promise<{ name: string }[]>) =>
      (await records).map((record) => record.name);

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

      test("EmptyingAScopeDoesNotRemoveIt", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "dev");
        const other = Scope.of("acme", "prod");

        await store.putSchema(scope, "posts", { type: "object" });
        const entry = await putEntry(store, scope, "posts", 1, { title: "x" });
        await store.putSchema(other, "posts", { type: "object" });

        expect((await store.listScopes()).map((s) => s.key()).sort()).toEqual([
          "acme/dev",
          "acme/prod",
        ]);

        // The reverse of what D20 promised, and deliberately so: deleting every
        // schema and entry empties the scope, it does not delete it. The records
        // are what exist, and only `deleteEnvironment` removes one.
        await store.delete(scope, "posts", entry.id);
        await store.deleteSchema(scope, "posts");

        expect((await store.listScopes()).map((s) => s.key()).sort()).toEqual([
          "acme/dev",
          "acme/prod",
        ]);
        expect(await store.listCollections(scope)).toEqual([]);

        await store.deleteEnvironment("acme", "dev");
        expect((await store.listScopes()).map((s) => s.key())).toEqual(["acme/prod"]);
      });

      // ---- Projects, environments and collections as records (D51) ----
      //
      // These port methods carry the whole "does this exist, and what is its
      // id" question, and the two adapters answer it from completely different
      // material — rows on one side, directories and marker files on the other.
      // Anything only one of them gets right is a portability bug by
      // construction: an export enumerates `listScopes()`, so a scope one
      // adapter reports and the other does not is data that survives on SQLite
      // and vanishes on files.

      test("CreatedProjectIsListedBeforeItHoldsAnything", async () => {
        const store = await getFreshStore();

        const project = await store.createProject("acme");
        expect(project.name).toBe("acme");
        expect(project.id.length).toBeGreaterThan(0);
        expect(await names(store.listProjects())).toEqual(["acme"]);
        // A project with no env yet is not a scope — there is nothing to address.
        expect(await store.listEnvironments("acme")).toEqual([]);
        expect(await store.listScopes()).toEqual([]);

        const environment = await store.createEnvironment("acme", "dev");
        expect(environment.project_id).toBe(project.id);
        expect(await names(store.listEnvironments("acme"))).toEqual(["dev"]);
        // The export-critical half: an env that was created but holds nothing
        // still exists, so `Exporter` can carry it across a round trip.
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["acme/dev"]);
      });

      test("CreateIsIdempotentAndKeepsTheOriginalId", async () => {
        const store = await getFreshStore();

        const first = await store.createProject("acme");
        const again = await store.createProject("acme");
        expect(again.id).toBe(first.id);

        const env = await store.createEnvironment("acme", "dev");
        expect((await store.createEnvironment("acme", "dev")).id).toBe(env.id);

        await store.deleteProject("never-existed");
        await store.deleteEnvironment("acme", "never-existed");
        await store.deleteEnvironment("never-existed", "dev");
        expect(await names(store.listProjects())).toEqual(["acme"]);
        expect(await names(store.listEnvironments("acme"))).toEqual(["dev"]);
      });

      test("SuppliedIdIsPreservedAndACollisionIsRefused", async () => {
        const store = await getFreshStore();

        // Import carries ids in its markers and must be able to keep them.
        const project = await store.createProject("acme", "01AAAAAAAAAAAAAAAAAAAAAAAA");
        expect(project.id).toBe("01AAAAAAAAAAAAAAAAAAAAAAAA");

        await expect(
          store.createProject("other", "01AAAAAAAAAAAAAAAAAAAAAAAA")
        ).rejects.toThrow();
        // Reserved ids belong to the system records and are never handed out.
        await expect(store.createProject("other", "_system")).rejects.toThrow();

        // A name that already exists keeps its own id, ignoring the archive's.
        expect((await store.createProject("acme", "01BBBBBBBBBBBBBBBBBBBBBBBB")).id).toBe(
          "01AAAAAAAAAAAAAAAAAAAAAAAA"
        );
      });

      test("PutSchemaCreatesTheScopeButAnEntryNeedsItsCollection", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("ghost", "prod");

        // A project and an environment are pure containers, so `putSchema`
        // still brings them into being implicitly.
        const record = await store.putSchema(scope, "posts", { type: "object" });
        expect(record.name).toBe("posts");
        expect(await names(store.listProjects())).toEqual(["ghost"]);
        expect(await names(store.listEnvironments("ghost"))).toEqual(["prod"]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["ghost/prod"]);

        // A collection is not a pure container — its schema is NOT NULL — so
        // nothing implicit can create one, and an entry into a collection that
        // has no record is refused rather than written unvalidated.
        await expect(
          store.put(
            {
              id: "01CCCCCCCCCCCCCCCCCCCCCCCC",
              project: scope.project,
              env: scope.env,
              collection: "absent",
              rev: 1,
              seq: 0,
              created_at: new Date(),
              updated_at: new Date(),
              data: {},
            },
            { usages: [], search: null }
          )
        ).rejects.toThrow(/not found/);
      });

      test("PutSchemaTwiceKeepsTheCollectionId", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "dev");

        const first = await store.putSchema(scope, "posts", { type: "object" });
        const second = await store.putSchema(scope, "posts", {
          type: "object",
          properties: { title: { type: "string" } },
        });

        // A re-put is a schema edit, not a new collection wearing the same name.
        expect(second.id).toBe(first.id);
        expect((await store.findCollection(scope, "posts"))?.id).toBe(first.id);
      });

      test("CreateEnvironmentImpliesItsProject", async () => {
        const store = await getFreshStore();
        await store.createEnvironment("acme", "dev");
        expect(await names(store.listProjects())).toEqual(["acme"]);
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

        expect(await names(store.listEnvironments("acme"))).toEqual(["prod"]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["acme/prod"]);
        expect(CollectionSchemas.map(await store.listCollections(dev)).size).toBe(0);
        expect((await store.list(dev, "posts", { limit: 50, offset: 0 })).total).toBe(0);
        // The sibling is untouched, and the project outlives the env.
        expect(CollectionSchemas.map(await store.listCollections(prod)).size).toBe(1);
        expect((await store.list(prod, "posts", { limit: 50, offset: 0 })).total).toBe(1);
        expect(await names(store.listProjects())).toEqual(["acme"]);
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

        expect(await names(store.listProjects())).toEqual(["other"]);
        expect(await store.listEnvironments("acme")).toEqual([]);
        expect((await store.listScopes()).map((sc) => sc.key())).toEqual(["other/prod"]);
        expect(CollectionSchemas.map(await store.listCollections(dev)).size).toBe(0);
        expect((await store.list(prod, "posts", { limit: 50, offset: 0 })).total).toBe(0);
        expect(CollectionSchemas.map(await store.listCollections(other)).size).toBe(1);
      });

      test("SystemScopeIsNeverListedAsAProjectOrEnvironment", async () => {
        const store = await getFreshStore();

        await putEntry(store, Scope.System, "_keys", 1, { label: "root" });
        await store.createProject("acme");

        expect(await names(store.listProjects())).toEqual(["acme"]);
        expect(await store.listEnvironments(Scope.System.project)).toEqual([]);
        expect(await store.listScopes()).toEqual([]);
      });

      test("SystemCollectionsAreRecordsButStayOutOfUserListings", async () => {
        const store = await getFreshStore();

        // Seeded by both adapters, so `_keys` has a collection record to hang
        // its entries off and the two answer `listCollections` alike.
        const system = await store.listCollections(Scope.System);
        expect(system.map((record) => record.name)).toContain("_keys");
        expect(system.map((record) => record.name)).toContain("_scope_renames");
        // Their ids are the reserved names, so every instance addresses them
        // identically and an archive needs no translation.
        expect(system.find((record) => record.name === "_keys")?.id).toBe("_keys");
      });
    });
  }
}
