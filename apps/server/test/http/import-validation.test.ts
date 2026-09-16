import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Exporter } from "../../src/core/transfer/exporter";
import { Importer } from "../../src/core/transfer/importer";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import type { Entry } from "../../src/core/domain/entry";

/**
 * Import validates every entry, with no flag to turn it off (D69).
 *
 * It used to be `--validate`, defaulting to false — so the guarantee that data
 * is validated on the way in had a door in it that every archive came through.
 * An entry the destination refuses is now reported rather than fatal: an
 * archive is usually mostly good, and one bad row should not cost the rest.
 */
describe("import validation", () => {
  let tempDir: string;
  let source: SqliteStore;
  let destination: SqliteStore;
  let archive: string;

  const scope = Scope.Default;

  const strict = {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  };

  const entry = (collection: string, data: any): Entry => ({
    id: EntryUtils.newID(),
    project: scope.project,
    env: scope.env,
    collection,
    rev: 1,
    seq: 0,
    created_at: new Date(Date.UTC(2026, 0, 1)),
    updated_at: new Date(Date.UTC(2026, 0, 1)),
    data,
  });

  /** Everything the source holds, written out ready to import. */
  const exported = async (): Promise<string> => {
    await fs.rm(archive, { recursive: true, force: true });
    await Exporter.exportDir(source, archive, {});
    return archive;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-validation-test-"));
    archive = path.join(tempDir, "archive");
    source = await SqliteStore.open(path.join(tempDir, "source.db"));
    destination = await SqliteStore.open(path.join(tempDir, "destination.db"));
  });

  afterEach(async () => {
    await source.close();
    await destination.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("a valid archive imports clean, and says so", async () => {
    await source.putSchema(scope, "posts", strict);
    await source.put(entry("posts", { title: "fine" }), { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), {});
    expect(result).toMatchObject({ added: 1, rejected: 0 });
    expect(result.rejections).toEqual([]);
  });

  test("an entry the schema refuses is skipped, counted and named", async () => {
    // Written past the service so the source itself holds what its schema
    // rejects — exactly the older-schema archive the old default waved through.
    await source.putSchema(scope, "posts", strict);
    const good = entry("posts", { title: "fine" });
    const bad = entry("posts", { title: 42 });
    await source.put(good, { usages: [], search: null });
    await source.put(bad, { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), {});

    expect(result.added).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({
      project: scope.project,
      env: scope.env,
      collection: "posts",
      id: bad.id,
    });
    expect(result.rejections[0]!.reason).toContain("validation failed");

    // The good one landed; the bad one did not.
    expect((await destination.get(scope, "posts", good.id)).data).toEqual({ title: "fine" });
    await expect(destination.get(scope, "posts", bad.id)).rejects.toThrow();
  });

  test("a reserved field name is refused as a rejection, not a crash", async () => {
    await source.putSchema(scope, "posts", { type: "object" });
    const reserved = entry("posts", { id: "mine" });
    await source.put(reserved, { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), {});
    expect(result).toMatchObject({ added: 0, rejected: 1 });
    expect(result.rejections[0]!.reason).toContain("reserved field");
  });

  test("the named list is capped while the count stays exact", async () => {
    await source.putSchema(scope, "posts", strict);
    for (let index = 0; index < Importer.RejectionLimit + 5; index++) {
      await source.put(entry("posts", { title: index }), { usages: [], search: null });
    }

    const result = await Importer.importDir(destination, await exported(), {});
    expect(result.rejected).toBe(Importer.RejectionLimit + 5);
    expect(result.rejections).toHaveLength(Importer.RejectionLimit);
  });

  test("a dry run writes nothing and judges nothing", async () => {
    await source.putSchema(scope, "posts", strict);
    await source.put(entry("posts", { title: 42 }), { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), { dryRun: true });
    // The schema it would have judged against is still unwritten, so a count
    // here would be a guess. It reports the entry as one it would add.
    expect(result).toMatchObject({ dry_run: true, added: 1, rejected: 0 });
  });

  test("merging a different schema over a populated collection is a conflict", async () => {
    await source.putSchema(scope, "posts", strict);
    await source.put(entry("posts", { title: "from source" }), { usages: [], search: null });

    await destination.putSchema(scope, "posts", { type: "object", properties: {} });
    await destination.put(entry("posts", { title: "already here" }), { usages: [], search: null });

    await expect(Importer.importDir(destination, await exported(), { mode: "merge" })).rejects.toThrow(
      /schema cannot change while they exist/
    );
  });

  test("replace mode is not blocked, because it empties the collection first", async () => {
    await source.putSchema(scope, "posts", strict);
    const incoming = entry("posts", { title: "from source" });
    await source.put(incoming, { usages: [], search: null });

    await destination.putSchema(scope, "posts", { type: "object", properties: {} });
    await destination.put(entry("posts", { title: "already here" }), { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), { mode: "replace" });
    expect(result).toMatchObject({ added: 1, deleted: 1, rejected: 0 });
    expect((await destination.get(scope, "posts", incoming.id)).data).toEqual({ title: "from source" });
  });

  test("a merge that changes only access is allowed over entries", async () => {
    await source.putSchema(scope, "posts", { ...strict, "x-silo-auth": true, title: "Posts" });
    await source.put(entry("posts", { title: "from source" }), { usages: [], search: null });

    await destination.putSchema(scope, "posts", strict);
    await destination.put(entry("posts", { title: "already here" }), { usages: [], search: null });

    const result = await Importer.importDir(destination, await exported(), { mode: "merge" });
    expect(result.rejected).toBe(0);
    expect(await destination.getSchema(scope, "posts")).toMatchObject({ "x-silo-auth": true });
  });
});
