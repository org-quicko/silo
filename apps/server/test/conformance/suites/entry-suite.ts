import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { Entry } from "../../../src/core/domain/entry";
import { MediaRefs } from "../../../src/core/media/media-refs";
import { SearchText } from "../../../src/core/search/search-text";
import type { StorageTestContext } from "../storage-test-context";

/** The entry lifecycle, `seq` allocation, and what the adapter reports about collections and instance metadata. */
export class EntrySuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);

    describe("entries", () => {
      test("EntryLifecycle", async () => {
        const store = await getFreshStore();
        const scope = Scope.Default;
        const e = await putEntry(store, scope, "posts", 1, { title: "alpha" });
        expect(e.seq).toBeGreaterThan(0);

        const got = await store.get(scope, "posts", e.id);
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
        await store.put(upd, { usages: MediaRefs.extract(upd.data), search: SearchText.extract(upd.data) });
        expect(upd.seq).toBeGreaterThan(e.seq);

        const got2 = await store.get(scope, "posts", e.id);
        expect(got2.rev).toBe(2);
        expect(got2.data).toEqual({ title: "alpha2" });

        await store.delete(scope, "posts", e.id);
        await expect(store.get(scope, "posts", e.id)).rejects.toThrow();
      });

      test("SeqMonotonic", async () => {
        const store = await getFreshStore();
        const scope = Scope.Default;
        const a = await putEntry(store, scope, "posts", 1, { title: "a" });
        const b = await putEntry(store, scope, "pages", 2, { title: "b" });
        const c = await putEntry(store, scope, "posts", 3, { title: "c" });

        expect(a.seq).toBeLessThan(b.seq);
        expect(b.seq).toBeLessThan(c.seq);

        const m = await store.meta();
        expect(m.last_seq).toBe(c.seq);
      });

      test("SeqMonotonicAcrossScopes", async () => {
        const store = await getFreshStore();
        const scopeA = Scope.of("a", "dev");
        const scopeB = Scope.of("b", "prod");

        const a1 = await putEntry(store, scopeA, "posts", 1, { title: "a1" });
        const b1 = await putEntry(store, scopeB, "posts", 2, { title: "b1" });
        const a2 = await putEntry(store, scopeA, "posts", 3, { title: "a2" });

        expect(a1.seq).toBeLessThan(b1.seq);
        expect(b1.seq).toBeLessThan(a2.seq);

        const m = await store.meta();
        expect(m.last_seq).toBe(a2.seq);
      });

      test("NotFound", async () => {
        const store = await getFreshStore();
        const scope = Scope.Default;
        await expect(store.get(scope, "posts", "01JMISSING")).rejects.toThrow();
        await expect(store.delete(scope, "posts", "01JMISSING")).rejects.toThrow();
        await expect(store.getSchema(scope, "nope")).rejects.toThrow();
      });

      // Entry-bearing collections are discovered independently of schemas: an
      // import archive can carry content/<collection>/ with nothing under
      // schemas/, and those entries are invisible to listSchemas().

      test("ListEntryCollections", async () => {
        const store = await getFreshStore();
        const a = Scope.of("acme", "prod");
        const b = Scope.of("acme", "dev");

        expect(await store.listEntryCollections(a)).toEqual([]);

        // A schema alone is not an entry-bearing collection.
        await store.putSchema(a, "schema-only", { type: "object" });
        expect(await store.listEntryCollections(a)).toEqual([]);

        await putEntry(store, a, "posts", 1, { title: "x" });
        await putEntry(store, a, "posts", 2, { title: "y" });
        await putEntry(store, a, "authors", 3, { title: "z" });
        await putEntry(store, b, "elsewhere", 4, { title: "w" });

        // Sorted, deduplicated, and scoped — b's collection must not leak in.
        expect(await store.listEntryCollections(a)).toEqual(["authors", "posts"]);
        expect(await store.listEntryCollections(b)).toEqual(["elsewhere"]);

        // Pruned once the last entry goes, matching listScopes()' rule that a
        // leftover directory is not content.
        const { items } = await store.list(a, "authors", { limit: 50, offset: 0 });
        for (const e of items) await store.delete(a, "authors", e.id);
        expect(await store.listEntryCollections(a)).toEqual(["posts"]);

        // System collections are reported like any other — the reserved scope
        // has no special-cased path in either adapter (D18).
        await putEntry(store, Scope.System, "_keys", 5, { hash: "h" });
        expect(await store.listEntryCollections(Scope.System)).toEqual(["_keys"]);
      });

      test("CountEntries", async () => {
        const store = await getFreshStore();
        const a = Scope.of("acme", "prod");
        const b = Scope.of("acme", "dev");

        expect(await store.countEntries(a)).toEqual(new Map());

        // A schema alone counts nothing, the same rule listEntryCollections
        // follows: an empty collection is absent rather than zero.
        await store.putSchema(a, "schema-only", { type: "object" });
        expect(await store.countEntries(a)).toEqual(new Map());

        await putEntry(store, a, "posts", 1, { title: "x" });
        await putEntry(store, a, "posts", 2, { title: "y" });
        await putEntry(store, a, "authors", 3, { title: "z" });
        await putEntry(store, b, "elsewhere", 4, { title: "w" });

        // Scoped: b's collection must not be counted into a's answer.
        expect(await store.countEntries(a)).toEqual(
          new Map([
            ["posts", 2],
            ["authors", 1],
          ])
        );
        expect(await store.countEntries(b)).toEqual(new Map([["elsewhere", 1]]));

        // Drops back out once the last entry goes, rather than reporting zero.
        const { items } = await store.list(a, "authors", { limit: 50, offset: 0 });
        for (const e of items) await store.delete(a, "authors", e.id);
        expect(await store.countEntries(a)).toEqual(new Map([["posts", 2]]));

        // The reserved scope has no special-cased path in either adapter (D18).
        await putEntry(store, Scope.System, "_keys", 5, { hash: "h" });
        expect(await store.countEntries(Scope.System)).toEqual(new Map([["_keys", 1]]));
      });

      test("Meta", async () => {
        const store = await getFreshStore();
        const m1 = await store.meta();
        expect(m1.instance_id).not.toBe("");
        expect(m1.last_seq).toBe(0);

        await putEntry(store, Scope.Default, "posts", 1, { title: "x" });
        const m2 = await store.meta();
        expect(m2.instance_id).toBe(m1.instance_id);
        expect(m2.last_seq).toBe(1);
      });
    });
  }
}
