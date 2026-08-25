import { describe, expect, test } from "bun:test";
import { Scope } from "../../../src/core/domain/scope";
import type { Entry } from "../../../src/core/domain/entry";
import { EntryUtils } from "../../../src/core/domain/entry-utils";
import type { StorageTestContext } from "../storage-test-context";

/** The `Storage` port's segment contract, enforced identically by both adapters so an import archive cannot behave differently depending on which one is running. */
export class SafetySuite {
  static register(context: StorageTestContext): void {
    const getFreshStore = () => context.fresh();
    const putEntry = context.putEntry.bind(context);

    describe("path safety", () => {
      test("RejectsUnsafeSegments", async () => {
        // A Storage port contract, not an fs-only defense: both adapters must
        // reject the same malformed collection/id/project/env identically.
        // This is what stands between an import archive's untrusted entry
        // `id` (taken from file contents, not the trusted archive path) and a
        // write that lands outside its scope — or, on fs, outside the data
        // dir entirely.
        const store = await getFreshStore();
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
          await expect(store.put(entryWith({ id: bad }), { usages: [], search: null })).rejects.toThrow();
          await expect(store.put(entryWith({ collection: bad }), { usages: [], search: null })).rejects.toThrow();
          await expect(store.get(scope, bad, "someid")).rejects.toThrow();
          await expect(store.delete(scope, bad, "someid")).rejects.toThrow();
          await expect(store.list(scope, bad, { limit: 50, offset: 0 })).rejects.toThrow();
          await expect(store.get(scope, "posts", bad)).rejects.toThrow();
          await expect(store.delete(scope, "posts", bad)).rejects.toThrow();
        }

        await expect(store.put(entryWith({ project: "../evil" }), { usages: [], search: null })).rejects.toThrow();
        await expect(store.put(entryWith({ env: "../evil" }), { usages: [], search: null })).rejects.toThrow();

        // The store must still work normally after rejecting malformed input.
        const ok = await putEntry(store, scope, "posts", 2, { title: "fine" });
        expect((await store.get(scope, "posts", ok.id)).data.title).toBe("fine");
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
    });
  }
}
