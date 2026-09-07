import { describe, test, expect } from "bun:test";
import { runStorageTestSuite } from "../conformance/storage-conformance";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { Scope } from "../../src/core/domain/scope";
import fs from "fs/promises";
import path from "path";
import os from "os";

let tempFsDir: string;

runStorageTestSuite(
  "Filesystem Store",
  async () => {
    tempFsDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fs-test-"));
    return await FsStore.open(tempFsDir);
  },
  async (store) => {
    await store.close();
    if (tempFsDir) {
      await fs.rm(tempFsDir, { recursive: true, force: true });
    }
  }
);

describe("FsStore data-dir format guard", () => {
  test("refuses a pre-D18 dir (flat schemas/content, format_version 1) rather than reading it as empty", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fs-guard-"));
    try {
      await fs.mkdir(path.join(dir, "schemas"), { recursive: true });
      await fs.mkdir(path.join(dir, "content", "posts"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "manifest.json"),
        JSON.stringify({ format_version: "1", instance_id: "x", last_seq: 0 }, null, 2),
        "utf8"
      );

      await expect(FsStore.open(dir)).rejects.toThrow(/format_version "1"/);

      // The refused dir must be left exactly as found — no stray `projects/`
      // directory created on the way to rejecting it.
      const entries = await fs.readdir(dir);
      expect(entries.sort()).toEqual(["content", "manifest.json", "schemas"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("opens a fresh dir and stamps the current format_version", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fs-guard-fresh-"));
    try {
      const store = await FsStore.open(dir);
      await store.close();

      const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
      expect(manifest.format_version).toBe("2");

      const projectsStat = await fs.stat(path.join(dir, "projects"));
      expect(projectsStat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FsStore addressing authority", () => {
  // A file's envelope is data, not addressing: the path it was found under is
  // the authority (D18). An envelope that disagrees used to be believed, which
  // forked entries across scopes on the next write and — for `id` — produced
  // entries `list` returned but `get`/`delete` could not find, leaving the
  // collection undeletable.
  test("ignores an envelope that disagrees with its path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fs-envelope-"));
    try {
      const store = await FsStore.open(dir);
      const scope = Scope.of("acme", "dev");
      await store.putSchema(scope, "posts", { type: "object" });

      const colDir = path.join(dir, "projects", "acme", "dev", "content", "posts");
      await fs.mkdir(colDir, { recursive: true });
      await fs.writeFile(
        path.join(colDir, "REAL.json"),
        JSON.stringify({
          id: "FORGED",
          project: "other",
          env: "prod",
          collection: "elsewhere",
          rev: 1,
          seq: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          data: { title: "forged" },
        }),
        "utf8"
      );

      const listed = await store.list(scope, "posts", { limit: 10, offset: 0 });
      expect(listed.items.map((e) => e.id)).toEqual(["REAL"]);
      expect(listed.items[0]).toMatchObject({ project: "acme", env: "dev", collection: "posts" });

      // Whatever `list` reports must be fetchable and deletable by that id.
      const got = await store.get(scope, "posts", listed.items[0]!.id);
      expect(got).toMatchObject({ id: "REAL", project: "acme", env: "dev", collection: "posts" });
      await store.delete(scope, "posts", listed.items[0]!.id);
      expect((await store.list(scope, "posts", { limit: 10, offset: 0 })).total).toBe(0);

      await store.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
