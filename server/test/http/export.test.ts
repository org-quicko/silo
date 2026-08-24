import { describe, test, expect } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { FsStore } from "../../adapters/storage/fs/fs-store";
import { Exporter } from "../../core/transfer/exporter";
import { Importer } from "../../core/transfer/importer";
import { FormatVersion } from "../../core/transfer/format-version";
import { EntryUtils } from "../../core/domain/entry-utils";
import { Scope } from "../../core/domain/scope";
import type { Entry } from "../../core/domain/entry";

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

      const res = await Importer.importTarGz(st2, tarPath, { mode: "replace", allowKeys: true });
      expect(res.added).toBe(1);
      expect(res.deleted).toBe(0);

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

      const res = await Importer.importDir(st2, expDir, {});
      expect(res.added).toBe(1);

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
      const res = await Importer.importDir(st2, expDir, { mode: "replace" });
      expect(res.added).toBe(2);

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
      const res = await Importer.importDir(st2, expDir, { mode: "replace" });
      expect(res.added).toBe(2);

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
      const importWithRemote = async (remote: Entry, instId: string, opts: any) => {
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
        return await Importer.importDir(stLocal, expDir, opts);
      };

      // 1. Case: Remote has newer timestamp
      const remoteEntryNewer = newEntry(
        Scope.Default, "posts", timeBase,
        { title: "remote v2" }
      );
      remoteEntryNewer.id = entryId;
      remoteEntryNewer.updated_at = new Date(timeBase.getTime() + 3600000); // +1 hour

      let res = await importWithRemote(remoteEntryNewer, "remote-inst", { mode: "merge" });
      expect(res.updated).toBe(1);
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

      res = await importWithRemote(remoteEntryOlder, "remote-inst", { mode: "merge" });
      expect(res.skipped).toBe(1);

      // 3. Case: Timestamps equal, higher Rev wins
      const localEntryEqualTime = newEntry(Scope.Default, "posts", timeBase, { title: "local equal" });
      localEntryEqualTime.id = entryId;
      localEntryEqualTime.rev = 10;
      await stLocal.put(localEntryEqualTime, { usages: [], search: null });

      const remoteEntryHigherRev = newEntry(Scope.Default, "posts", timeBase, { title: "remote higher rev" });
      remoteEntryHigherRev.id = entryId;
      remoteEntryHigherRev.rev = 12;

      res = await importWithRemote(remoteEntryHigherRev, "remote-inst", { mode: "merge" });
      expect(res.updated).toBe(1);

      // 4. Case: Overrides with Prefer Option
      res = await importWithRemote(localEntryEqualTime, "remote-inst", { mode: "merge", prefer: "local" });
      expect(res.skipped).toBe(1);

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
