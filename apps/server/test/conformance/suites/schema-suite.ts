import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { StorageTestContext } from "../storage-test-context";

/** Schema CRUD, and the scoping rule that keeps one scope's schemas out of another's listing. */
export class SchemaSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();

    describe("schemas", () => {
      test("SchemaCRUD", async () => {
        const store = await getFreshStore();
        const scope = Scope.Default;
        const s1 = { type: "object" };
        const s2 = { type: "object", required: ["title"] };

        await store.putSchema(scope, "posts", s1);
        let got = await store.getSchema(scope, "posts");
        expect(got).toEqual(s1);

        await store.putSchema(scope, "posts", s2);
        got = await store.getSchema(scope, "posts");
        expect(got).toEqual(s2);

        const all = await store.listSchemas(scope);
        expect(all.size).toBe(1);
        expect(all.get("posts")).toEqual(s2);

        await store.deleteSchema(scope, "posts");
        await expect(store.getSchema(scope, "posts")).rejects.toThrow();
        await expect(store.deleteSchema(scope, "posts")).rejects.toThrow();
      });

      test("ListSchemasIsScopedToOneScope", async () => {
        const store = await getFreshStore();
        const scopeA = Scope.of("a", "dev");
        const scopeB = Scope.of("b", "prod");

        await store.putSchema(scopeA, "posts", { type: "object" });
        await store.putSchema(scopeA, "pages", { type: "object" });
        await store.putSchema(scopeB, "posts", { type: "object" });

        const aSchemas = await store.listSchemas(scopeA);
        expect(aSchemas.size).toBe(2);
        expect([...aSchemas.keys()].sort()).toEqual(["pages", "posts"]);

        const bSchemas = await store.listSchemas(scopeB);
        expect(bSchemas.size).toBe(1);
        expect([...bSchemas.keys()]).toEqual(["posts"]);
      });
    });
  }
}
