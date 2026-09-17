import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Scope } from "../../src/core/domain/scope";
import type { Entry } from "../../src/core/domain/entry";
import { ImportEntries } from "../../src/core/transfer/import-entries";

/**
 * A collection's entries are read when the importer reaches them (D77).
 *
 * The property is easy to lose by accident — an `await` in the wrong place puts
 * the whole archive back in memory and nothing fails — so it is pinned by the
 * one observation that can only hold if the read is deferred: a directory that
 * does not exist when the reader is built.
 */
describe("ImportEntries", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-entries-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  });

  const write = async (id: string, data: unknown) => {
    await fs.writeFile(
      path.join(directory, `${id}.json`),
      JSON.stringify({
        id,
        project: "ignored",
        env: "ignored",
        collection: "ignored",
        rev: 1,
        seq: 0,
        created_at: "2026-09-17T00:00:00.000Z",
        updated_at: "2026-09-17T00:00:00.000Z",
        data,
      }),
      "utf8",
    );
  };

  const drain = async (entries: ImportEntries): Promise<Entry[]> => {
    const out: Entry[] = [];
    for await (const entry of entries) out.push(entry);
    return out;
  };

  test("nothing is read until it is iterated", async () => {
    const absent = path.join(directory, "not-yet");
    // Built against a directory that does not exist. An eager reader would
    // have thrown right here.
    const entries = ImportEntries.inDirectory(absent, Scope.Default, "posts");

    await fs.mkdir(absent);
    await fs.writeFile(
      path.join(absent, "01ARZ3NDEKTSV4RRFFQ69G5FAV.json"),
      JSON.stringify({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", rev: 1, seq: 0, created_at: "2026-09-17T00:00:00.000Z", updated_at: "2026-09-17T00:00:00.000Z", data: { title: "late" } }),
      "utf8",
    );

    const read = await drain(entries);
    expect(read.map((entry) => entry.data)).toEqual([{ title: "late" }]);
  });

  test("the path is the addressing authority, not the file's own fields", async () => {
    await write("01ARZ3NDEKTSV4RRFFQ69G5FAV", { title: "one" });
    const entries = ImportEntries.inDirectory(directory, Scope.of("site", "prod"), "posts");

    const [entry] = await drain(entries);
    expect(entry!.project).toBe("site");
    expect(entry!.env).toBe("prod");
    expect(entry!.collection).toBe("posts");
    expect(entry!.created_at).toBeInstanceOf(Date);
  });

  test("dot files and non-JSON are skipped, as the eager reader skipped them", async () => {
    await write("01ARZ3NDEKTSV4RRFFQ69G5FAV", { title: "kept" });
    await fs.writeFile(path.join(directory, ".hidden.json"), "{}", "utf8");
    await fs.writeFile(path.join(directory, "notes.txt"), "not an entry", "utf8");

    expect((await drain(ImportEntries.inDirectory(directory, Scope.Default, "posts"))).length).toBe(1);
  });

  test("a filter narrows without reading anything twice or early", async () => {
    await write("01ARZ3NDEKTSV4RRFFQ69G5FAV", { keep: true });
    await write("01ARZ3NDEKTSV4RRFFQ69G5FAW", { keep: false });

    const kept = ImportEntries.inDirectory(directory, Scope.Default, "posts").filter(
      (entry) => (entry.data as { keep: boolean }).keep,
    );
    expect((await drain(kept)).length).toBe(1);
  });

  test("entries already in hand iterate too, which is what a scope copy hands over", async () => {
    const entry = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      project: "site",
      env: "prod",
      collection: "posts",
      rev: 1,
      seq: 0,
      created_at: new Date(),
      updated_at: new Date(),
      data: { title: "in memory" },
    } as Entry;

    expect(await drain(ImportEntries.of([entry]))).toEqual([entry]);
  });

  test("iterating twice reads the directory twice rather than answering nothing", async () => {
    // A dry run and the run after it are separate walks, but a caller that
    // re-reads one reader must not silently get an empty second pass.
    await write("01ARZ3NDEKTSV4RRFFQ69G5FAV", { title: "one" });
    const entries = ImportEntries.inDirectory(directory, Scope.Default, "posts");

    expect((await drain(entries)).length).toBe(1);
    expect((await drain(entries)).length).toBe(1);
  });
});
