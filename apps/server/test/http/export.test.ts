import { describe, test, expect } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { Exporter } from "../../src/core/transfer/exporter";
import { Importer } from "../../src/core/transfer/importer";
import { AuditUtils } from "../../src/core/audit/audit-utils";
import { SiloService } from "../../src/core/services/silo-service";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { FormatVersion } from "../../src/core/transfer/format-version";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import type { Entry } from "../../src/core/domain/entry";

const newEntry = (scope: Scope, collection: string, ts: Date, data: any): Entry => ({
  id: EntryUtils.newID(),
  project: scope.project,
  env: scope.env,
  collection,
  rev: 1,
  seq: 0,
  created_at: ts,
  updated_at: ts,
  data,
});

/**
 * A blob too big to gzip into a single chunk, cheap to build: one random block
 * repeated, so it is large without being slow or compressible to nothing.
 */
const randomBlob = (size: number): Uint8Array => {
  const block = 65536;
  const data = new Uint8Array(size);
  crypto.getRandomValues(data.subarray(0, Math.min(block, size)));
  for (let offset = block; offset < size; offset += block) {
    data.set(data.subarray(0, Math.min(block, size - offset)), offset);
  }
  return data;
};

/** How many of a transfer's temp trees exist right now. */
const countTempDirs = async (prefix: string): Promise<number> => {
  const names = await fs.readdir(os.tmpdir());
  return names.filter((name) => name.startsWith(prefix)).length;
};

/**
 * Waits for the temp-tree count to come back to `target`.
 *
 * A streamed archive outlives the call that created it, so removing its tree
 * is the stream's own job and nothing can await it — polling is what tells
 * "cleaned up a moment later" apart from "leaked", where reading the count
 * once only races it. The tmpdir holds other runs' leftovers, so this is a
 * return to a baseline rather than a count of zero.
 */
const expectTempDirsSettle = async (prefix: string, target: number): Promise<void> => {
  const deadline = Date.now() + 5000;
  for (;;) {
    const count = await countTempDirs(prefix);
    if (count <= target) return;
    if (Date.now() > deadline) {
      expect(count).toBe(target);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("Export / Import Tests", () => {
  test("ExportImportTarGzRoundTrip", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const srcDb = path.join(tempDir, "src.db");
      const st1 = await SqliteStore.open(srcDb);

      const schema1 = { type: "object", properties: { title: { type: "string" } } };
      await st1.putSchema(Scope.Default, "posts", schema1);

      const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
      const e1 = newEntry(Scope.Default, "posts", time1, { title: "hello" });
      await st1.put(e1, { usages: [], search: null });

      // Export to tarball file
      const tarPath = path.join(tempDir, "export1.tar.gz");
      await Exporter.exportTarGz(st1, tarPath, {
        withKeys: true,
        siloVersion: "0.1.0-test",
        exportedAt: time1,
      });

      // Import into FS store
      const fsDir = path.join(tempDir, "fs_data");
      const st2 = await FsStore.open(fsDir);

      const response = await Importer.importTarGz(st2, tarPath, { mode: "replace", allowKeys: true });
      expect(response.added).toBe(1);
      expect(response.deleted).toBe(0);

      const schemaGot = await st2.getSchema(Scope.Default, "posts");
      expect(schemaGot).toEqual(schema1);

      const eGot = await st2.get(Scope.Default, "posts", e1.id);
      expect(eGot.id).toBe(e1.id);
      expect(eGot.project).toBe(Scope.Default.project);
      expect(eGot.env).toBe(Scope.Default.env);
      expect(eGot.data).toEqual(e1.data);
      expect(eGot.created_at.toISOString()).toBe(e1.created_at.toISOString());

      // Export FS to tarball file
      const tarPath2 = path.join(tempDir, "export2.tar.gz");
      await Exporter.exportTarGz(st2, tarPath2, {
        withKeys: true,
        siloVersion: "0.1.0-test",
        exportedAt: time1,
      });

      // Import into fresh SQLite store
      const destDb = path.join(tempDir, "dest.db");
      const st3 = await SqliteStore.open(destDb);

      const res2 = await Importer.importTarGz(st3, tarPath2, { mode: "replace", allowKeys: true });
      expect(res2.added).toBe(1);

      const schemaGot2 = await st3.getSchema(Scope.Default, "posts");
      expect(schemaGot2).toEqual(schema1);

      const eGot2 = await st3.get(Scope.Default, "posts", e1.id);
      expect(eGot2.id).toBe(e1.id);
      expect(eGot2.data).toEqual(e1.data);
      expect(eGot2.created_at.toISOString()).toBe(e1.created_at.toISOString());
      expect(eGot2.updated_at.toISOString()).toBe(e1.updated_at.toISOString());
      expect(eGot2.rev).toBe(e1.rev);

      await st1.close();
      await st2.close();
      await st3.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ExportImportDirRoundTrip", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const srcDb = path.join(tempDir, "src.db");
      const st1 = await SqliteStore.open(srcDb);

      const schema1 = { type: "object" };
      await st1.putSchema(Scope.Default, "posts", schema1);

      const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
      const e1 = newEntry(Scope.Default, "posts", time1, { title: "hello" });
      await st1.put(e1, { usages: [], search: null });

      // Export to directory
      const expDir = path.join(tempDir, "export_dir");
      await Exporter.exportDir(st1, expDir, {});

      // Confirm the D18 archive layout: projects/<project>/<env>/{schemas,content}
      const schemaFile = path.join(
        expDir, "projects", Scope.Default.project, Scope.Default.env,
        "schemas", "posts.schema.json"
      );
      expect(await fs.readFile(schemaFile, "utf8")).toBeTruthy();
      const entryFile = path.join(
        expDir, "projects", Scope.Default.project, Scope.Default.env,
        "content", "posts", `${e1.id}.json`
      );
      expect(await fs.readFile(entryFile, "utf8")).toBeTruthy();

      const manifest = JSON.parse(await fs.readFile(path.join(expDir, "manifest.json"), "utf8"));
      expect(manifest.format_version).toBe(FormatVersion);
      expect(manifest.collections[`${Scope.Default.key()}/posts`]).toBe(1);

      // Import back into fresh SQLite store
      const destDb = path.join(tempDir, "dest.db");
      const st2 = await SqliteStore.open(destDb);

      const response = await Importer.importDir(st2, expDir, {});
      expect(response.added).toBe(1);

      const eGot = await st2.get(Scope.Default, "posts", e1.id);
      expect(eGot.id).toBe(e1.id);
      expect(eGot.data).toEqual(e1.data);

      await st1.close();
      await st2.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ExportImportPreservesScopeSeparation", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const srcDb = path.join(tempDir, "src.db");
      const st1 = await SqliteStore.open(srcDb);

      const scopeA = Scope.of("acme", "dev");
      const scopeB = Scope.of("acme", "prod");

      await st1.putSchema(scopeA, "posts", { type: "object", required: ["title"] });
      await st1.putSchema(scopeB, "posts", { type: "object" });

      const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
      const entryA = newEntry(scopeA, "posts", time1, { title: "dev post" });
      const entryB = newEntry(scopeB, "posts", time1, { title: "prod post" });
      await st1.put(entryA, { usages: [], search: null });
      await st1.put(entryB, { usages: [], search: null });

      const expDir = path.join(tempDir, "export_dir");
      await Exporter.exportDir(st1, expDir, {});

      const manifest = JSON.parse(await fs.readFile(path.join(expDir, "manifest.json"), "utf8"));
      expect(manifest.collections["acme/dev/posts"]).toBe(1);
      expect(manifest.collections["acme/prod/posts"]).toBe(1);

      const destDb = path.join(tempDir, "dest.db");
      const st2 = await SqliteStore.open(destDb);
      const response = await Importer.importDir(st2, expDir, { mode: "replace" });
      expect(response.added).toBe(2);

      // Two scopes in, two scopes out: same collection name stays distinct.
      const scopes = await st2.listScopes();
      expect(scopes.map((s) => s.key()).sort()).toEqual(["acme/dev", "acme/prod"]);

      const gotA = await st2.get(scopeA, "posts", entryA.id);
      expect(gotA.data.title).toBe("dev post");
      const gotB = await st2.get(scopeB, "posts", entryB.id);
      expect(gotB.data.title).toBe("prod post");

      await expect(st2.get(scopeB, "posts", entryA.id)).rejects.toThrow();
      await expect(st2.get(scopeA, "posts", entryB.id)).rejects.toThrow();

      const listA = await st2.list(scopeA, "posts", { limit: 50, offset: 0 });
      expect(listA.total).toBe(1);
      const listB = await st2.list(scopeB, "posts", { limit: 50, offset: 0 });
      expect(listB.total).toBe(1);

      await st1.close();
      await st2.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ExportImportPreservesScopeSeparationOnFsAdapter", async () => {
    // The SQLite version of this round trip above doesn't exercise the fs
    // adapter's own scope-tree walk at all — this is that coverage.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-fs-"));
    try {
      const srcDir = path.join(tempDir, "src_data");
      const st1 = await FsStore.open(srcDir);

      const scopeA = Scope.of("acme", "dev");
      const scopeB = Scope.of("acme", "prod");

      await st1.putSchema(scopeA, "posts", { type: "object", required: ["title"] });
      await st1.putSchema(scopeB, "posts", { type: "object" });

      const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
      const entryA = newEntry(scopeA, "posts", time1, { title: "dev post" });
      const entryB = newEntry(scopeB, "posts", time1, { title: "prod post" });
      await st1.put(entryA, { usages: [], search: null });
      await st1.put(entryB, { usages: [], search: null });

      const expDir = path.join(tempDir, "export_dir");
      await Exporter.exportDir(st1, expDir, {});

      const manifest = JSON.parse(await fs.readFile(path.join(expDir, "manifest.json"), "utf8"));
      expect(manifest.collections["acme/dev/posts"]).toBe(1);
      expect(manifest.collections["acme/prod/posts"]).toBe(1);

      const destDir = path.join(tempDir, "dest_data");
      const st2 = await FsStore.open(destDir);
      const response = await Importer.importDir(st2, expDir, { mode: "replace" });
      expect(response.added).toBe(2);

      const scopes = await st2.listScopes();
      expect(scopes.map((s) => s.key()).sort()).toEqual(["acme/dev", "acme/prod"]);

      const gotA = await st2.get(scopeA, "posts", entryA.id);
      expect(gotA.data.title).toBe("dev post");
      const gotB = await st2.get(scopeB, "posts", entryB.id);
      expect(gotB.data.title).toBe("prod post");

      await expect(st2.get(scopeB, "posts", entryA.id)).rejects.toThrow();
      await expect(st2.get(scopeA, "posts", entryB.id)).rejects.toThrow();

      const listA = await st2.list(scopeA, "posts", { limit: 50, offset: 0 });
      expect(listA.total).toBe(1);
      const listB = await st2.list(scopeB, "posts", { limit: 50, offset: 0 });
      expect(listB.total).toBe(1);

      await st1.close();
      await st2.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ImportRejectsPathTraversalInEntryId", async () => {
    // A hand-crafted archive — not one Exporter would ever produce — whose
    // entry id is a traversal string taken straight from file *contents*.
    // ImportWalker trusts the path for scope/collection but (before this
    // fix) passed `id` through unvalidated into Storage.put, which fed it
    // straight into a filesystem path on the fs adapter.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-traversal-"));
    try {
      const archiveDir = path.join(tempDir, "archive");
      const destDir = path.join(tempDir, "dest");

      const scope = Scope.of("attacker", "dev");
      const contentDir = path.join(archiveDir, "projects", scope.project, scope.env, "content", "posts");
      await fs.mkdir(contentDir, { recursive: true });

      // Depth matters: `../../evil/PLANTED` only reaches
      // <dest>/projects/attacker/dev/evil, still inside the data dir, so
      // asserting on <tempDir>/evil would pass even with the guard removed.
      // Six levels up from .../content/posts/ actually leaves <dest>.
      const maliciousId = "../../../../../../evil/PLANTED";
      const now = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString();
      await fs.writeFile(
        path.join(contentDir, "x.json"),
        JSON.stringify(
          {
            id: maliciousId,
            project: scope.project,
            env: scope.env,
            collection: "posts",
            rev: 1,
            seq: 1,
            created_at: now,
            updated_at: now,
            data: { title: "planted" },
          },
          null,
          2
        ),
        "utf8"
      );

      const manifest = {
        format_version: FormatVersion,
        instance_id: EntryUtils.newID(),
        last_seq: 1,
        collections: { [`${scope.key()}/posts`]: 1 },
      };
      await fs.writeFile(path.join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

      const destStore = await FsStore.open(destDir);
      await expect(Importer.importDir(destStore, archiveDir, { mode: "merge" })).rejects.toThrow();

      // Nothing landed outside the destination data dir — this is the path
      // the malicious id actually resolves to, so it fails if the guard goes.
      const escaped = path.join(tempDir, "evil", "PLANTED.json");
      const escapedExists = await fs.access(escaped).then(
        () => true,
        () => false
      );
      expect(escapedExists).toBe(false);
      expect(await fs.readdir(path.join(tempDir, "evil")).catch(() => [])).toEqual([]);

      // ...nor anywhere inside the destination's own tree for that scope.
      const destContentDir = path.join(destDir, "projects", scope.project, scope.env, "content", "posts");
      const destFiles = await fs.readdir(destContentDir).catch(() => []);
      expect(destFiles.length).toBe(0);
      const destScopeDir = path.join(destDir, "projects", scope.project, scope.env);
      expect(await fs.readdir(path.join(destScopeDir, "evil")).catch(() => [])).toEqual([]);

      await destStore.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ImportMergeConflicts", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const localDb = path.join(tempDir, "local.db");
      const stLocal = await SqliteStore.open(localDb);

      await stLocal.putSchema(Scope.Default, "posts", { type: "object" });

      const timeBase = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
      const entryId = EntryUtils.newID();

      // Seed local entry
      const localEntry = newEntry(Scope.Default, "posts", timeBase, { title: "local v1" });
      localEntry.id = entryId;
      await stLocal.put(localEntry, { usages: [], search: null });

      // Helper to import a remote entry using directory modification
      const importWithRemote = async (remote: Entry, instId: string, options: any) => {
        const remoteDb = path.join(tempDir, `remote-${EntryUtils.newID()}.db`);

        const stRemote = await SqliteStore.open(remoteDb);
        await stRemote.putSchema(Scope.Default, "posts", { type: "object" });
        await stRemote.put(remote, { usages: [], search: null });

        const expDir = path.join(tempDir, "remote_exp");
        await fs.rm(expDir, { recursive: true, force: true });
        await Exporter.exportDir(stRemote, expDir, {});

        // Modify manifest.json to override instance_id
        const manifestPath = path.join(expDir, "manifest.json");
        const manifestData = await fs.readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestData);
        manifest.instance_id = instId;
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

        await stRemote.close();
        return await Importer.importDir(stLocal, expDir, options);
      };

      // 1. Case: Remote has newer timestamp
      const remoteEntryNewer = newEntry(
        Scope.Default, "posts", timeBase,
        { title: "remote v2" }
      );
      remoteEntryNewer.id = entryId;
      remoteEntryNewer.updated_at = new Date(timeBase.getTime() + 3600000); // +1 hour

      let response = await importWithRemote(remoteEntryNewer, "remote-inst", { mode: "merge" });
      expect(response.updated).toBe(1);
      let got = await stLocal.get(Scope.Default, "posts", entryId);
      expect(got.data.title).toBe("remote v2");

      // 2. Case: Local has newer timestamp
      const localEntryNewer = newEntry(Scope.Default, "posts", timeBase, { title: "local v3" });
      localEntryNewer.id = entryId;
      localEntryNewer.rev = 2;
      localEntryNewer.updated_at = new Date(timeBase.getTime() + 7200000); // +2 hours
      await stLocal.put(localEntryNewer, { usages: [], search: null });

      const remoteEntryOlder = newEntry(Scope.Default, "posts", timeBase, { title: "remote older" });
      remoteEntryOlder.id = entryId;
      remoteEntryOlder.rev = 3;
      remoteEntryOlder.updated_at = new Date(timeBase.getTime() + 3600000); // +1 hour

      response = await importWithRemote(remoteEntryOlder, "remote-inst", { mode: "merge" });
      expect(response.skipped).toBe(1);

      // 3. Case: Timestamps equal, higher Rev wins
      const localEntryEqualTime = newEntry(Scope.Default, "posts", timeBase, { title: "local equal" });
      localEntryEqualTime.id = entryId;
      localEntryEqualTime.rev = 10;
      await stLocal.put(localEntryEqualTime, { usages: [], search: null });

      const remoteEntryHigherRev = newEntry(Scope.Default, "posts", timeBase, { title: "remote higher rev" });
      remoteEntryHigherRev.id = entryId;
      remoteEntryHigherRev.rev = 12;

      response = await importWithRemote(remoteEntryHigherRev, "remote-inst", { mode: "merge" });
      expect(response.updated).toBe(1);

      // 4. Case: Overrides with Prefer Option
      response = await importWithRemote(localEntryEqualTime, "remote-inst", { mode: "merge", prefer: "local" });
      expect(response.skipped).toBe(1);

      await stLocal.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ImportRejectsUnknownFormatVersion", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const manifest = {
        format_version: "999",
        instance_id: EntryUtils.newID(),
        last_seq: 0,
      };
      await fs.mkdir(path.join(tempDir, "projects"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "manifest.json"), JSON.stringify(manifest), "utf8");

      const dstDb = path.join(tempDir, "dst.db");
      const st = await SqliteStore.open(dstDb);

      await expect(Importer.importDir(st, tempDir, { mode: "merge" })).rejects.toThrow(/format_version/);
      await st.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

/**
 * A plugin's managed key is left out of every archive (D34).
 *
 * `--with-keys` exists so an instance can be cloned with its credentials
 * intact, and a managed key is not one anybody holds: silo mints it, keeps the
 * secret, and rotates it. Carried across, it would land in the destination as a
 * record no `_plugins` grant points at, that the ordinary revoke path refuses
 * to remove, and that nothing can ever authenticate as.
 */
describe("managed keys are not exportable", () => {
  test("--with-keys carries ordinary keys and skips plugin-owned ones", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-managed-export-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "src.db"));
      const service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      await service.scopes.initDefaults();

      const { entry: ordinary } = await service.keys.create("mine", ["media:read"]);
      await service.plugins.reconcile("acme", ["collections:*/*/*:entries:read"], []);
      const grant = await service.plugins.grant("acme", ["collections:*/*/*:entries:read"], { actor: AuditUtils.cli() });

      const dest = path.join(tempDir, "out");
      await Exporter.exportDir(store, dest, { withKeys: true });

      const keysDir = path.join(dest, "projects", "_system", "_system", "content", "_keys");
      const files = await fs.readdir(keysDir);
      expect(files).toContain(`${ordinary.id}.json`);
      expect(files).not.toContain(`${grant.key_id}.json`);

      await store.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

/**
 * The trail and the grants stay out of archives (D34/D38).
 *
 * `_audit` and `_plugins` are `_`-prefixed, so `Exporter.skipCollection` already
 * excludes them — but by a rule that names `_keys` and `_media` explicitly and
 * everything else by prefix. Asserted rather than assumed, because the failure
 * is a disclosure: an archive is the one artifact that leaves the instance, and
 * the trail names every key and every claim ever granted on it.
 */
describe("system collections stay out of archives", () => {
  test("neither _audit nor _plugins is exported, even with --with-keys", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-system-export-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "src.db"));
      const service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      await service.scopes.initDefaults();

      await service.keys.create("mine", ["media:read"], { actor: AuditUtils.cli() });
      await service.plugins.reconcile("acme", ["media:read"], []);
      await service.plugins.grant("acme", ["media:read"], { actor: AuditUtils.cli() });
      expect((await service.audit.list()).total).toBeGreaterThan(0);

      const dest = path.join(tempDir, "out");
      await Exporter.exportDir(store, dest, { withKeys: true });

      const systemDir = path.join(dest, "projects", "_system", "_system", "content");
      const collections = await fs.readdir(systemDir);
      expect(collections).toContain("_keys");
      expect(collections).not.toContain("_audit");
      expect(collections).not.toContain("_plugins");

      await store.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("the export tarball streams rather than buffering", () => {
  // The HTTP export path used to read the finished tarball into one Buffer,
  // which made peak memory scale with the media library (D5 puts every media
  // byte in the archive). These cover the streamed replacement: that it is a
  // real archive, that it arrives in pieces rather than all at once, and that
  // the temp tree it is built from does not outlive it.
  test("ExportTarGzStreamsInChunksAndCleansUp", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "src.db"));
      await store.putSchema(Scope.Default, "posts", { type: "object" });
      const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
      const e1 = newEntry(Scope.Default, "posts", time1, { title: "hello" });
      await store.put(e1, { usages: [], search: null });

      // Well past one gzip chunk: a small archive would fit in a single chunk
      // and prove nothing about streaming.
      const mediaDir = path.join(tempDir, "media");
      const blobs = new FsBlobStorage(mediaDir);
      const big = randomBlob(4 * 1024 * 1024);
      await blobs.put("big.bin", big);

      const before = await countTempDirs("silo-export-");

      const stream = await Exporter.exportTarGzStream(
        store,
        { siloVersion: "0.1.0-test", exportedAt: time1 },
        mediaDir
      );

      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      expect(chunks.length).toBeGreaterThan(1);

      const archive = Buffer.concat(chunks);
      // gzip magic — the stream is the tarball itself, not a description of it.
      expect(archive[0]).toBe(0x1f);
      expect(archive[1]).toBe(0x8b);

      // The temp tree the archive was built from is gone once the stream ends.
      await expectTempDirsSettle("silo-export-", before);

      // And it is importable, media included.
      const tarPath = path.join(tempDir, "streamed.tar.gz");
      await fs.writeFile(tarPath, archive);
      const destStore = await SqliteStore.open(path.join(tempDir, "dest.db"));
      const destBlobs = new FsBlobStorage(path.join(tempDir, "dest-media"));
      const response = await Importer.importTarGz(
        destStore,
        tarPath,
        { mode: "replace" },
        destBlobs
      );
      expect(response.added).toBe(1);
      expect((await destStore.get(Scope.Default, "posts", e1.id)).data).toEqual(e1.data);
      expect((await destBlobs.get("big.bin"))?.size).toBe(big.length);

      await store.close();
      await destStore.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ExportTarGzWritesToAWriterInChunks", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "src.db"));
      await store.putSchema(Scope.Default, "posts", { type: "object" });
      const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
      const e1 = newEntry(Scope.Default, "posts", time1, { title: "hello" });
      await store.put(e1, { usages: [], search: null });

      const mediaDir = path.join(tempDir, "media");
      await new FsBlobStorage(mediaDir).put("big.bin", randomBlob(4 * 1024 * 1024));

      // A writer rather than a path. It must be fed chunk by chunk, and the
      // exporter must not close what it did not open.
      const written: Uint8Array[] = [];
      let closed = false;
      const writer = {
        write: async (chunk: Uint8Array) => {
          written.push(chunk);
        },
        close: async () => {
          closed = true;
        },
      };

      await Exporter.exportTarGz(
        store,
        writer,
        { siloVersion: "0.1.0-test", exportedAt: time1 },
        mediaDir
      );

      expect(written.length).toBeGreaterThan(1);
      expect(closed).toBe(false);

      const archive = Buffer.concat(written);
      const tarPath = path.join(tempDir, "written.tar.gz");
      await fs.writeFile(tarPath, archive);
      const destStore = await SqliteStore.open(path.join(tempDir, "dest.db"));
      const response = await Importer.importTarGz(destStore, tarPath, { mode: "replace" });
      expect(response.added).toBe(1);

      await store.close();
      await destStore.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ExportTarGzRejectsAWriterItCannotWriteTo", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "src.db"));
      // An object with no write method reached the write call and failed as a
      // TypeError; a null writer threw before the check meant to catch it.
      await expect(Exporter.exportTarGz(store, {}, {})).rejects.toThrow(
        "unsupported writer type"
      );
      await expect(Exporter.exportTarGz(store, null, {})).rejects.toThrow(
        "unsupported writer type"
      );
      await store.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("HttpExportStreamsAnImportableArchive", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-test-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "silo.db"));
      const service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      const rootKey = await service.keys.bootstrap();
      await service.collections.putSchema(Scope.Default, "posts", { type: "object" });
      const app = new SiloServer(service, {
        version: "test",
        authDisabled: false,
        logger: Logger.silent(),
      }).build();

      const before = await countTempDirs("silo-export-");

      const httpResponse = await app.request("/api/export", {
        headers: { Authorization: `Bearer ${rootKey}` },
      });
      expect(httpResponse.status).toBe(200);
      expect(httpResponse.headers.get("Content-Type")).toBe("application/gzip");

      const archive = Buffer.from(await httpResponse.arrayBuffer());
      expect(archive[0]).toBe(0x1f);
      expect(archive[1]).toBe(0x8b);
      await expectTempDirsSettle("silo-export-", before);

      const tarPath = path.join(tempDir, "http.tar.gz");
      await fs.writeFile(tarPath, archive);
      const destStore = await SqliteStore.open(path.join(tempDir, "dest.db"));
      // Nothing there before the import, so the assertion after it means something.
      await expect(destStore.getSchema(Scope.Default, "posts")).rejects.toThrow("not found");
      await Importer.importTarGz(destStore, tarPath, { mode: "replace" });
      expect(await destStore.getSchema(Scope.Default, "posts")).toEqual({ type: "object" });

      await store.close();
      await destStore.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("an archive can be loaded from a stream, not only a buffer", () => {
  /** An archive on disk, with a media blob in it, and the pieces to check. */
  const archiveWithMedia = async (tempDir: string) => {
    const store = await SqliteStore.open(path.join(tempDir, "src.db"));
    await store.putSchema(Scope.Default, "posts", { type: "object" });
    const time1 = new Date(Date.UTC(2026, 0, 1, 10, 0, 0));
    const entry = newEntry(Scope.Default, "posts", time1, { title: "hello" });
    await store.put(entry, { usages: [], search: null });

    const mediaDir = path.join(tempDir, "media");
    const blob = randomBlob(4 * 1024 * 1024);
    await new FsBlobStorage(mediaDir).put("big.bin", blob);

    const tarPath = path.join(tempDir, "archive.tar.gz");
    await Exporter.exportTarGz(
      store,
      tarPath,
      { siloVersion: "0.1.0-test", exportedAt: time1 },
      mediaDir
    );
    await store.close();
    return { tarPath, entry, blob };
  };

  test("ImportTarGzStreamLoadsAndCleansUp", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-test-"));
    try {
      const { tarPath, entry, blob } = await archiveWithMedia(tempDir);

      const before = await countTempDirs("silo-import-");

      const destStore = await SqliteStore.open(path.join(tempDir, "dest.db"));
      const destBlobs = new FsBlobStorage(path.join(tempDir, "dest-media"));
      const response = await Importer.importTarGzStream(
        destStore,
        Bun.file(tarPath).stream(),
        { mode: "replace" },
        destBlobs
      );

      expect(response.added).toBe(1);
      expect((await destStore.get(Scope.Default, "posts", entry.id)).data).toEqual(entry.data);
      // The media rides in the archive, so a streamed load has to land it too.
      expect((await destBlobs.get("big.bin"))?.size).toBe(blob.length);
      // The extracted tree is gone, and no `import.tar.gz` was ever written.
      await expectTempDirsSettle("silo-import-", before);

      await destStore.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("ImportTarGzStreamRefusesATruncatedArchive", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-test-"));
    try {
      const { tarPath } = await archiveWithMedia(tempDir);
      // Half an archive. The gzip failure has to be the error that comes out:
      // a pump that dropped it reported the *downstream* symptom instead — an
      // ENOENT on the `manifest.json` that was never extracted — which says
      // nothing about the upload being truncated.
      const whole = await fs.readFile(tarPath);
      const half = whole.subarray(0, Math.floor(whole.length / 2));

      const destStore = await SqliteStore.open(path.join(tempDir, "dest.db"));
      const before = await countTempDirs("silo-import-");

      await expect(
        Importer.importTarGzStream(
          destStore,
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(half);
              controller.close();
            },
          }),
          { mode: "replace" }
        )
      ).rejects.toThrow("unexpected end of file");
      await expectTempDirsSettle("silo-import-", before);

      await destStore.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("HttpImportAcceptsARawBodyAndAForm", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-test-"));
    try {
      const { tarPath, entry, blob } = await archiveWithMedia(tempDir);
      const archive = await fs.readFile(tarPath);

      const load = async (init: RequestInit) => {
        const store = await SqliteStore.open(
          path.join(tempDir, `dest-${EntryUtils.newID()}.db`)
        );
        const mediaDir = path.join(tempDir, `dest-media-${EntryUtils.newID()}`);
        const service = new SiloService(store, { mediaDir });
        const rootKey = await service.keys.bootstrap();
        const app = new SiloServer(service, {
          version: "test",
          authDisabled: false,
          logger: Logger.silent(),
        }).build();

        const response = await app.request("/api/import?mode=replace", {
          method: "POST",
          ...init,
          headers: {
            Authorization: `Bearer ${rootKey}`,
            ...((init.headers as Record<string, string>) || {}),
          },
        });
        const body = (await response.json()) as any;
        return { status: response.status, body, store, mediaDir };
      };

      // The raw body is the streaming path, and what the admin now sends.
      const raw = await load({
        headers: { "Content-Type": "application/gzip" },
        body: archive,
      });
      expect(raw.status).toBe(200);
      expect(raw.body.added).toBe(1);
      expect((await raw.store.get(Scope.Default, "posts", entry.id)).data).toEqual(entry.data);
      expect((await new FsBlobStorage(raw.mediaDir).get("big.bin"))?.size).toBe(blob.length);
      await raw.store.close();

      // A form still works, for callers already posting one.
      const form = new FormData();
      form.append("file", new Blob([archive]), "silo-export.tar.gz");
      const multipart = await load({ body: form });
      expect(multipart.status).toBe(200);
      expect(multipart.body.added).toBe(1);
      expect((await multipart.store.get(Scope.Default, "posts", entry.id)).data).toEqual(
        entry.data
      );
      await multipart.store.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("HttpImportRefusesARequestWithNoBody", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-test-"));
    try {
      const store = await SqliteStore.open(path.join(tempDir, "silo.db"));
      const service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      const rootKey = await service.keys.bootstrap();
      const app = new SiloServer(service, {
        version: "test",
        authDisabled: false,
        logger: Logger.silent(),
      }).build();

      const response = await app.request("/api/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${rootKey}`, "Content-Type": "application/gzip" },
      });
      expect(response.status).toBe(400);
      expect((await response.json()) as any).toMatchObject({
        error: { message: expect.stringContaining("missing archive") },
      });

      await store.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
