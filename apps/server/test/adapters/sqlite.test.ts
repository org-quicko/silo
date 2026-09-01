import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { runStorageTestSuite } from "../conformance/storage-conformance";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FormatVersion } from "../../src/core/transfer/format-version";
import fs from "fs/promises";
import path from "path";
import os from "os";

let tempDbDir: string;

runStorageTestSuite(
  "SQLite Store",
  async () => {
    tempDbDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-sqlite-test-"));
    const dbPath = path.join(tempDbDir, "test.db");
    return await SqliteStore.open(dbPath);
  },
  async (store) => {
    await store.close();
    if (tempDbDir) {
      await fs.rm(tempDbDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

describe("SqliteStore data-dir format guard", () => {
  test("refuses a pre-D51 db stamped format_version 2 rather than crashing on a missing column", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-sqlite-guard-"));
    try {
      const dbPath = path.join(dir, "silo.db");
      const db = new Database(dbPath, { create: true });
      db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      db.exec(`CREATE TABLE schemas (collection TEXT PRIMARY KEY, schema TEXT NOT NULL, updated_at TEXT NOT NULL);`);
      db.exec(`
        CREATE TABLE entries (
          id TEXT NOT NULL, collection TEXT NOT NULL, rev INTEGER NOT NULL,
          seq INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          data TEXT NOT NULL, PRIMARY KEY (collection, id)
        );
      `);
      db.prepare(
        `INSERT INTO meta (key, value) VALUES ('instance_id', 'x'), ('last_seq', '0'), ('format_version', '2')`
      ).run();
      db.close();

      await expect(SqliteStore.open(dbPath)).rejects.toThrow(/format_version "2"/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("refuses old-shaped tables even with no format_version row to contradict", async () => {
    // The exact hole the guard's own comment claimed to close: a pre-D18 db
    // whose `meta` table exists but never got a `format_version` row (or
    // lost it) must still be refused by inspecting the table shape itself,
    // not just trusting an absent/stale row.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-sqlite-guard-noversion-"));
    try {
      const dbPath = path.join(dir, "silo.db");
      const db = new Database(dbPath, { create: true });
      db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      db.exec(`CREATE TABLE schemas (collection TEXT PRIMARY KEY, schema TEXT NOT NULL, updated_at TEXT NOT NULL);`);
      db.exec(`
        CREATE TABLE entries (
          id TEXT NOT NULL, collection TEXT NOT NULL, rev INTEGER NOT NULL,
          seq INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          data TEXT NOT NULL, PRIMARY KEY (collection, id)
        );
      `);
      db.prepare(`INSERT INTO meta (key, value) VALUES ('instance_id', 'x'), ('last_seq', '0')`).run();
      db.close();

      await expect(SqliteStore.open(dbPath)).rejects.toThrow(/format_version/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("opens a fresh db and stamps the current format_version", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-sqlite-guard-fresh-"));
    try {
      const dbPath = path.join(dir, "silo.db");
      const store = await SqliteStore.open(dbPath);
      const meta = await store.meta();
      expect(meta.instance_id).not.toBe("");
      await store.close();

      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(FormatVersion);
      db.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
