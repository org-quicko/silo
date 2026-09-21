import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import type { Entry } from "../../src/core/domain/entry";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import type { Storage } from "../../src/core/ports/storage";
import { Exporter } from "../../src/core/transfer/exporter";
import { Importer } from "../../src/core/transfer/importer";

/**
 * Replace mode never empties a collection before it fills it (D85). The
 * 2026-09-18 audit's H6: it deleted every row and then wrote the archive's, so
 * a failure between the two — a full disk, an OOM kill, a stop — left the
 * collection empty and nothing coming. Now every row the archive carries is
 * written over what is there and every row it does not carry is removed after,
 * so an interruption leaves extra rows, never missing ones.
 */
describe("replace mode writes first and removes after", () => {
  let tempDir: string;
  let source: SqliteStore;
  let destination: SqliteStore;

  const scope = Scope.Default;

  const entry = (id: string, data: unknown): Entry => ({
    id,
    project: scope.project,
    env: scope.env,
    collection: "posts",
    rev: 1,
    seq: 0,
    created_at: new Date(Date.UTC(2026, 0, 1)),
    updated_at: new Date(Date.UTC(2026, 0, 1)),
    data,
  });

  const exported = async (): Promise<string> => {
    const archive = path.join(tempDir, "archive");
    await fs.rm(archive, { recursive: true, force: true });
    await Exporter.exportDir(source, archive, {});
    return archive;
  };

  const ids = async (store: Storage): Promise<string[]> =>
    (await store.list(scope, "posts", { limit: 100, offset: 0 })).items.map((item) => item.id).sort();

  /** The destination, failing on the n-th write the way a full disk would. */
  const failingAfter = (store: Storage, writes: number): Storage => {
    let seen = 0;
    return new Proxy(store, {
      get(target, property) {
        if (property === "put") {
          return async (...args: Parameters<Storage["put"]>) => {
            if (++seen > writes) throw new Error("disk full");
            return target.put(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  const shared = EntryUtils.newID();
  const onlyLocal = EntryUtils.newID();
  const onlyRemote = EntryUtils.newID();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-replace-"));
    source = await SqliteStore.open(path.join(tempDir, "source.db"));
    destination = await SqliteStore.open(path.join(tempDir, "destination.db"));

    await source.putSchema(scope, "posts", { type: "object" });
    await source.put(entry(shared, { title: "from the archive" }), { usages: [], search: null });
    await source.put(entry(onlyRemote, { title: "new" }), { usages: [], search: null });

    await destination.putSchema(scope, "posts", { type: "object" });
    await destination.put(entry(shared, { title: "stale" }), { usages: [], search: null });
    await destination.put(entry(onlyLocal, { title: "gone after replace" }), { usages: [], search: null });
  });

  afterEach(async () => {
    await source.close();
    await destination.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("the collection ends as the archive's content, and the counts read as before", async () => {
    const result = await Importer.importDir(destination, await exported(), { mode: "replace" });

    // `deleted` is what was there — overwritten or removed — and `added` is
    // what the archive carried, the same numbers the empty-then-fill order gave.
    expect(result).toMatchObject({ added: 2, deleted: 2, rejected: 0 });
    expect(await ids(destination)).toEqual([shared, onlyRemote].sort());
    expect((await destination.get(scope, "posts", shared)).data).toEqual({ title: "from the archive" });
  });

  test("an interrupted replace leaves rows behind, never a collection with nothing in it", async () => {
    const archive = await exported();
    const failing = failingAfter(destination, 1);

    const interrupted = Importer.importDir(failing, archive, { mode: "replace" });
    await interrupted.catch(() => {});
    await expect(interrupted).rejects.toThrow(/disk full/);

    // What was there is still there: the old order had emptied it by now.
    const remaining = await ids(destination);
    expect(remaining.length).toBeGreaterThanOrEqual(2);
    expect(remaining).toContain(onlyLocal);

    // And the next run converges on the archive.
    await Importer.importDir(destination, archive, { mode: "replace" });
    expect(await ids(destination)).toEqual([shared, onlyRemote].sort());
  });

  test("a row the archive carries but the schema refuses is removed, not kept as it was", async () => {
    await source.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    });
    await source.put(entry(shared, { title: 42 }), { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), { mode: "replace" });
    expect(result.rejected).toBe(1);
    expect(await ids(destination)).toEqual([onlyRemote]);
  });

  test("a collection the archive carries only a schema for is emptied", async () => {
    await source.delete(scope, "posts", shared);
    await source.delete(scope, "posts", onlyRemote);

    const result = await Importer.importDir(destination, await exported(), { mode: "replace" });
    expect(result).toMatchObject({ added: 0, deleted: 2 });
    expect(await ids(destination)).toEqual([]);
  });
});
