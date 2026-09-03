import { describe, expect, test } from "bun:test";
import type { Entry } from "../../../src/core/domain/entry";
import { EntryUtils } from "../../../src/core/domain/entry-utils";
import { Scope } from "../../../src/core/domain/scope";
import type { Storage } from "../../../src/core/ports/storage";
import { MediaRefs } from "../../../src/core/media/media-refs";
import { SearchText } from "../../../src/core/search/search-text";
import { MediaRef } from "@silo/shared/media-ref";
import type { StorageTestContext } from "../storage-test-context";

/**
 * Reference counting (D23), which the two adapters reach by completely
 * different means: SQLite maintains a `media_references` table inside its write
 * transactions, the fs adapter keeps no index and scans.
 *
 * A divergence would mean a media file that one backend refuses to delete and
 * the other silently orphans — exactly the class of bug this suite exists to
 * catch.
 */
export class MediaUsageSuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();

    describe("media usages", () => {
      const REF_A = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";
      const REF_B = "01J8XQ50P1R2S3T4U5V6W7X8Y9";

      const putWithRefs = async (
        store: Storage,
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
        await context.ensureCollection(store, scope, collection);
        await store.put(e, { usages: MediaRefs.extract(e.data), search: SearchText.extract(e.data) });
        return e;
      };

      test("a written entry registers its references", async () => {
        const store = await getFreshStore();
        const e = await putWithRefs(store, Scope.Default, "posts", [REF_A, REF_B]);

        const usage = await store.listMediaUsages([REF_A]);
        expect(usage.total).toBe(1);
        expect(usage.items[0]).toMatchObject({
          media_id: REF_A,
          project: Scope.Default.project,
          env: Scope.Default.env,
          collection: "posts",
          entry_id: e.id,
        });

        const counts = await store.countMediaUsages([REF_A, REF_B]);
        expect(counts.get(REF_A)).toBe(1);
        expect(counts.get(REF_B)).toBe(1);

        expect((await store.listMediaUsages([])).total).toBe(0);
        expect((await store.listMediaUsages(["nobody-references-me"])).total).toBe(0);
      });

      test("rewriting an entry replaces its reference set wholesale", async () => {
        const store = await getFreshStore();
        const e = await putWithRefs(store, Scope.Default, "posts", [REF_A]);

        const moved: Entry = { ...e, rev: 2, data: { cover: MediaRef.url(REF_B) } };
        await store.put(moved, { usages: MediaRefs.extract(moved.data), search: SearchText.extract(moved.data) });

        // The old reference must be gone, not merely joined by the new one —
        // an accumulating index would keep REF_A blocked forever.
        expect((await store.listMediaUsages([REF_A])).total).toBe(0);
        expect((await store.listMediaUsages([REF_B])).total).toBe(1);
      });

      test("deleting an entry drops its references", async () => {
        const store = await getFreshStore();
        const e = await putWithRefs(store, Scope.Default, "posts", [REF_A]);

        await store.delete(Scope.Default, "posts", e.id);
        expect((await store.listMediaUsages([REF_A])).total).toBe(0);
      });

      test("deleting a scope drops the references its entries held", async () => {
        const store = await getFreshStore();
        const scope = Scope.of("acme", "prod");
        await store.createEnvironment(scope.project, scope.env);
        await putWithRefs(store, scope, "posts", [REF_A]);
        await putWithRefs(store, Scope.Default, "posts", [REF_A]);
        expect((await store.listMediaUsages([REF_A])).total).toBe(2);

        // The bulk path: SQLite deletes these rows with one statement and
        // never calls `delete` per entry, which is why this cleanup cannot
        // live above the port.
        await store.deleteEnvironment(scope.project, scope.env);
        expect((await store.listMediaUsages([REF_A])).total).toBe(1);

        await store.deleteProject(Scope.Default.project);
        expect((await store.listMediaUsages([REF_A])).total).toBe(0);
      });

      test("usages are counted across scopes and collections, and page", async () => {
        const store = await getFreshStore();
        const other = Scope.of("acme", "prod");
        await store.createEnvironment(other.project, other.env);

        await putWithRefs(store, Scope.Default, "posts", [REF_A]);
        await putWithRefs(store, Scope.Default, "pages", [REF_A]);
        await putWithRefs(store, other, "posts", [REF_A]);

        const all = await store.listMediaUsages([REF_A], { limit: 100 });
        expect(all.total).toBe(3);
        expect(all.items.length).toBe(3);

        const page = await store.listMediaUsages([REF_A], { limit: 2, offset: 0 });
        expect(page.total).toBe(3);
        expect(page.items.length).toBe(2);

        const rest = await store.listMediaUsages([REF_A], { limit: 2, offset: 2 });
        expect(rest.items.length).toBe(1);

        // A count-only probe — what the delete guard asks for.
        expect((await store.listMediaUsages([REF_A], { limit: 0 })).total).toBe(3);
      });

      test("references in system collections count too", async () => {
        const store = await getFreshStore();
        await putWithRefs(store, Scope.System, "_media_probe", [REF_A]);
        expect((await store.listMediaUsages([REF_A])).total).toBe(1);
      });
    });
  }
}
