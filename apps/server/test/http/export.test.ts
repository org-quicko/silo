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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
      expect(manifest.format_version).toBe("2");
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
