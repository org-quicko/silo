import { describe, expect, test } from "bun:test";
import { MediaRef } from "@silo/shared/media-ref";
import type { Entry } from "../../../src/core/domain/entry";
import { EntryUtils } from "../../../src/core/domain/entry-utils";
import { Scope } from "../../../src/core/domain/scope";
import { CommitConflictError } from "../../../src/core/errors/commit-conflict-error";
import { NotFoundError } from "../../../src/core/errors/not-found-error";
import { MediaRefs } from "../../../src/core/media/media-refs";
import type { AtomicStorage } from "../../../src/core/ports/atomic-storage";
import type { CommitPrecondition } from "../../../src/core/ports/commit-precondition";
import type { CommitWrite } from "../../../src/core/ports/commit-write";
import { SearchText } from "../../../src/core/search/search-text";
import type { StorageTestContext } from "../storage-test-context";

/**
 * `AtomicStorage.commit` (D107): every write lands, or none does, and a
 * precondition that no longer holds stops it before the first write.
 *
 * Registered only for adapters that offer it. Rejections are taken with
 * `try`/`catch` because a refused commit has rolled a transaction back, the
 * shape code-design.md warns `.rejects` about on Postgres.
 */
export class CommitSuite {
  private static readonly Media = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";
  private static readonly Target = Scope.of("acme", "uat");

  static register(context: StorageTestContext): void {
    const fresh = async () => (await context.fresh()) as AtomicStorage;

    describe("atomic commit", () => {
      test("lands every write together, the derived rows with them", async () => {
        const store = await fresh();
        const kept = await context.putEntry(store, Scope.Default, "posts", 1, { title: "old" });
        const removed = await context.putEntry(store, Scope.Default, "posts", 2, { title: "gone" });
        const page = CommitSuite.entry(CommitSuite.Target, "pages", { cover: MediaRef.url(CommitSuite.Media) });

        await store.commit({
          preconditions: [
            CommitSuite.at(kept, kept.seq),
            CommitSuite.at(removed, removed.seq),
            CommitSuite.at(page, null),
            { kind: "collection", scope: CommitSuite.Target, collection: "pages", record: null },
          ],
          writes: [
            { kind: "schema", scope: CommitSuite.Target, collection: "pages", schema: { type: "object" } },
            CommitSuite.put(page),
            CommitSuite.put({ ...kept, data: { title: "new" } }),
            { kind: "delete", scope: Scope.Default, collection: "posts", id: removed.id },
          ],
        });

        expect((await store.get(CommitSuite.Target, "pages", page.id)).data).toEqual(page.data);
        expect((await store.get(Scope.Default, "posts", kept.id)).data).toEqual({ title: "new" });
        expect(await CommitSuite.refusal(store.get(Scope.Default, "posts", removed.id))).toBeInstanceOf(
          NotFoundError
        );
        expect((await store.countMediaUsages([CommitSuite.Media])).get(CommitSuite.Media)).toBe(1);
      });

      const stale: [string, (store: AtomicStorage, kept: Entry) => Promise<CommitPrecondition>][] = [
        [
          "an entry written since it was read",
          async (store, kept) => {
            const read = kept.seq;
            await store.put({ ...kept, data: { title: "edited" } }, CommitSuite.derived({}));
            return CommitSuite.at(kept, read);
          },
        ],
        ["an entry expected absent that exists", async (_store, kept) => CommitSuite.at(kept, null)],
        [
          "a collection whose record changed",
          async (store) => {
            const record = (await store.findCollection(Scope.Default, "posts"))!;
            const earlier = new Date(record.updated_at.getTime() - 60_000).toISOString();
            const stamp = { id: record.id, updatedAt: earlier };
            return { kind: "collection", scope: Scope.Default, collection: "posts", record: stamp };
          },
        ],
        [
          "a collection expected absent that exists",
          async () => ({ kind: "collection", scope: Scope.Default, collection: "posts", record: null }),
        ],
        [
          "a collection that gained a row",
          async (store, kept) => {
            await context.putEntry(store, Scope.Default, "posts", 2, { title: "extra" });
            const rows = [{ id: kept.id, seq: kept.seq }];
            return { kind: "entries", scope: Scope.Default, collection: "posts", rows };
          },
        ],
      ];

      for (const [name, precondition] of stale) {
        test(`refuses, writing nothing, when it meets ${name}`, async () => {
          const store = await fresh();
          const kept = await context.putEntry(store, Scope.Default, "posts", 1, { title: "old" });
          const required = await precondition(store, kept);
          const added = CommitSuite.entry(Scope.Default, "posts", { title: "added" });

          const caught = await CommitSuite.refusal(
            store.commit({ preconditions: [required], writes: [CommitSuite.put(added)] })
          );

          expect(caught).toBeInstanceOf(CommitConflictError);
          expect((caught as CommitConflictError).conflicts).toEqual([required]);
          expect(await CommitSuite.refusal(store.get(Scope.Default, "posts", added.id))).toBeInstanceOf(
            NotFoundError
          );
        });
      }

      test("a write that fails part way leaves nothing it made behind", async () => {
        const store = await fresh();
        const kept = await context.putEntry(store, Scope.Default, "posts", 1, { title: "old" });
        const page = CommitSuite.entry(CommitSuite.Target, "pages", { cover: MediaRef.url(CommitSuite.Media) });

        const caught = await CommitSuite.refusal(
          store.commit({
            preconditions: [],
            writes: [
              { kind: "schema", scope: CommitSuite.Target, collection: "pages", schema: { type: "object" } },
              CommitSuite.put(page),
              CommitSuite.put({ ...kept, data: { title: "new" } }),
              CommitSuite.put(CommitSuite.entry(Scope.Default, "nowhere", { title: "refused" })),
            ],
          })
        );

        // The last write is the one refused, so the three before it did run.
        expect(caught).toBeInstanceOf(NotFoundError);
        expect((caught as Error).message).toContain("nowhere");
        expect(await store.findProject(CommitSuite.Target.project)).toBeNull();
        expect(await store.findCollection(CommitSuite.Target, "pages")).toBeNull();
        const after = await store.get(Scope.Default, "posts", kept.id);
        expect(after.data).toEqual({ title: "old" });
        expect(after.seq).toBe(kept.seq);
        expect((await store.countMediaUsages([CommitSuite.Media])).get(CommitSuite.Media) ?? 0).toBe(0);
      });
    });
  }

  private static entry(scope: Scope, collection: string, data: Record<string, unknown>): Entry {
    const timestamp = new Date(Date.UTC(2026, 0, 1));
    return {
      id: EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection,
      rev: 1,
      seq: 0,
      created_at: timestamp,
      updated_at: timestamp,
      data,
    };
  }

  private static put(entry: Entry): CommitWrite {
    return { kind: "put", entry, derived: CommitSuite.derived(entry.data) };
  }

  private static derived(data: unknown) {
    return { usages: MediaRefs.extract(data), search: SearchText.extract(data) };
  }

  private static at(entry: Entry, seq: number | null): CommitPrecondition {
    const scope = Scope.of(entry.project, entry.env);
    return { kind: "entry", scope, collection: entry.collection, id: entry.id, seq };
  }

  private static async refusal(attempt: Promise<unknown>): Promise<unknown> {
    try {
      await attempt;
    } catch (caught) {
      return caught;
    }
    throw new Error("expected a refusal");
  }
}
