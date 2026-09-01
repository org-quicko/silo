import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { StorageTestContext } from "../storage-test-context";

/**
 * Renaming a project, environment or collection (D51), in both adapters.
 *
 * The two do it by completely different means — one `UPDATE` of a `name` column
 * against an `fs.rename` of a directory, and for a collection a multi-file move
 * with its own recovery — so this is where they are held to the same answers.
 * What every case really checks is one property: **the id does not move, and the
 * content follows the name.**
 */
export class RenameSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);

    describe("renames", () => {
      test("ProjectRenameKeepsIdsAndContent", async () => {
        const store = await getFreshStore();
        const before = Scope.of("acme", "dev");

        const project = await store.createProject("acme");
        const environment = await store.createEnvironment("acme", "dev");
        const collection = await store.putSchema(before, "posts", { type: "object" });
        const entry = await putEntry(store, before, "posts", 1, { title: "x" });

        await store.renameProject(project.id, "globex");

        const after = Scope.of("globex", "dev");
        expect((await store.findProject("globex"))?.id).toBe(project.id);
        expect(await store.findProject("acme")).toBeNull();
        // Nothing beneath it moved: same ids, same entry, same seq.
        expect((await store.findEnvironment("globex", "dev"))?.id).toBe(environment.id);
        expect((await store.findCollection(after, "posts"))?.id).toBe(collection.id);

        const read = await store.get(after, "posts", entry.id);
        expect(read.data.title).toBe("x");
        expect(read.seq).toBe(entry.seq);
        expect(read.rev).toBe(entry.rev);
        expect(read.created_at.toISOString()).toBe(entry.created_at.toISOString());
        // The envelope reports the new name, because it is derived rather than
        // stored beside the row.
        expect(read.project).toBe("globex");

        expect((await store.listScopes()).map((s) => s.key())).toEqual(["globex/dev"]);
        await expect(store.get(before, "posts", entry.id)).rejects.toThrow();
      });

      test("EnvironmentRenameKeepsIdsAndContent", async () => {
        const store = await getFreshStore();
        const before = Scope.of("acme", "dev");

        const environment = await store.createEnvironment("acme", "dev");
        const collection = await store.putSchema(before, "posts", { type: "object" });
        const entry = await putEntry(store, before, "posts", 1, { title: "x" });

        await store.renameEnvironment(environment.id, "staging");

        const after = Scope.of("acme", "staging");
        expect((await store.findEnvironment("acme", "staging"))?.id).toBe(environment.id);
        expect(await store.findEnvironment("acme", "dev")).toBeNull();
        expect((await store.findCollection(after, "posts"))?.id).toBe(collection.id);
        expect((await store.get(after, "posts", entry.id)).env).toBe("staging");
        expect((await store.listScopes()).map((s) => s.key())).toEqual(["acme/staging"]);
      });

      test("CollectionRenameKeepsIdsAndContent", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "dev");

        const collection = await store.putSchema(scope, "posts", {
          type: "object",
          properties: { title: { type: "string" } },
        });
        const entry = await putEntry(store, scope, "posts", 1, { title: "x" });

        await store.renameCollection(collection.id, "articles");

        const renamed = await store.findCollection(scope, "articles");
        expect(renamed?.id).toBe(collection.id);
        expect(renamed?.schema.properties.title.type).toBe("string");
        expect(await store.findCollection(scope, "posts")).toBeNull();

        const read = await store.get(scope, "articles", entry.id);
        expect(read.data.title).toBe("x");
        expect(read.collection).toBe("articles");
        expect(read.seq).toBe(entry.seq);
        await expect(store.get(scope, "posts", entry.id)).rejects.toThrow();

        // The entry moved with the collection rather than being left behind
        // under a name nothing lists.
        expect(await store.listEntryCollections(scope)).toEqual(["articles"]);
      });

      test("RenameRefusesACollision", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "dev");

        const acme = await store.createProject("acme");
        await store.createProject("globex");
        await expect(store.renameProject(acme.id, "globex")).rejects.toThrow();

        const dev = await store.createEnvironment("acme", "dev");
        await store.createEnvironment("acme", "prod");
        await expect(store.renameEnvironment(dev.id, "prod")).rejects.toThrow();

        const posts = await store.putSchema(scope, "posts", { type: "object" });
        await store.putSchema(scope, "articles", { type: "object" });
        await expect(store.renameCollection(posts.id, "articles")).rejects.toThrow();

        // Every refusal left both names exactly as they were.
        expect((await store.findProject("acme"))?.id).toBe(acme.id);
        expect((await store.findCollection(scope, "posts"))?.id).toBe(posts.id);
      });

      test("RenameToTheSameNameIsANoOp", async () => {
        const store = await getFreshStore();
        const project = await store.createProject("acme");

        await store.renameProject(project.id, "acme");
        expect((await store.findProject("acme"))?.id).toBe(project.id);
      });

      test("RenameOfAnUnknownIdIsRefused", async () => {
        const store = await getFreshStore();
        await store.createProject("acme");

        await expect(store.renameProject("01ZZZZZZZZZZZZZZZZZZZZZZZZ", "globex")).rejects.toThrow();
        await expect(
          store.renameCollection("01ZZZZZZZZZZZZZZZZZZZZZZZZ", "articles")
        ).rejects.toThrow();
      });

      test("EnvironmentNamesAreUniquePerProjectOnly", async () => {
        const store = await getFreshStore();

        // Two projects may each hold a `prod`, so renaming one to `prod` is not
        // a collision with the other's.
        const first = await store.createEnvironment("acme", "dev");
        await store.createEnvironment("globex", "prod");

        await store.renameEnvironment(first.id, "prod");
        expect((await store.findEnvironment("acme", "prod"))?.id).toBe(first.id);
        expect((await store.listScopes()).map((s) => s.key()).sort()).toEqual([
          "acme/prod",
          "globex/prod",
        ]);
      });

      test("RenamedScopeKeepsItsMediaUsagesAndReportsTheNewName", async () => {
        const store = await getFreshStore();
        const before = Scope.of("acme", "dev");
        const mediaId = "01MMMMMMMMMMMMMMMMMMMMMMMM";

        await store.putSchema(before, "posts", { type: "object" });
        const entry = await putEntry(store, before, "posts", 1, {
          cover: `silo://media/${mediaId}`,
        });

        const project = await store.findProject("acme");
        await store.renameProject(project!.id, "globex");

        // The reference survives, and the 409 body's names follow the rename —
        // which is what the read side joining back to the records is for.
        const usage = await store.listMediaUsages([mediaId]);
        expect(usage.total).toBe(1);
        expect(usage.items[0].project).toBe("globex");
        expect(usage.items[0].env).toBe("dev");
        expect(usage.items[0].collection).toBe("posts");
        expect(usage.items[0].entry_id).toBe(entry.id);
      });
    });
  }
}
