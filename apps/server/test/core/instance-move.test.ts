import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Claims } from "@silo/shared/claims";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { AuditUtils } from "../../src/core/audit/audit-utils";
import type { Entry } from "../../src/core/domain/entry";
import { Scope } from "../../src/core/domain/scope";
import { SystemCollections } from "../../src/core/domain/system-collections";
import type { Storage } from "../../src/core/ports/storage";
import { SiloService } from "../../src/core/services/silo-service";
import { Exporter } from "../../src/core/transfer/exporter";
import { ImportGrants } from "../../src/core/transfer/import-grants";
import { Importer } from "../../src/core/transfer/importer";
import { TransferSelection } from "../../src/core/transfer/transfer-selection";
import { AsyncChecks } from "../adapters/support/async-checks";
import { PgTestDatabase } from "../adapters/support/pg-test-database";

/**
 * `silo export --instance` and the import that loads it (D97): the way to
 * change storage driver without losing what a plain export leaves behind —
 * the plugin grants, the keys silo minted for them, and the audit log.
 */
describe("moving a whole instance", () => {
  let tempDir: string;
  let source: SqliteStore;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-instance-move-"));
    source = await SqliteStore.open(path.join(tempDir, "source.db"));
    service = new SiloService(source, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();

    await source.putSchema(Scope.Default, "posts", { type: "object" });
    await source.put(entry(Scope.Default, "posts", "hello", { title: "hello" }), { usages: [], search: null });
    await service.keys.create("mine", ["media:create"], { actor: AuditUtils.cli() });
    await service.plugins.reconcile("acme", ["media:create"], []);
    await service.plugins.grant("acme", ["media:create"], { actor: AuditUtils.cli() });
  });

  afterEach(async () => {
    await source.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** Exports the source as a move and loads it into `destination` through the CLI's grants. */
  async function move(destination: Storage): Promise<SiloService> {
    const archive = path.join(tempDir, "archive");
    const manifest = await Exporter.exportDir(source, archive, { instance: true });
    expect(manifest.instance).toBe(true);
    const result = await Importer.importDir(destination, archive, { grants: ImportGrants.Trusted });
    expect(result.rejected).toBe(0);
    return new SiloService(destination, { mediaDir: path.join(tempDir, "media") });
  }

  /** Everything a driver switch has to keep, compared source to destination. */
  async function expectSameInstance(moved: SiloService): Promise<void> {
    expect((await moved.store.get(Scope.Default, "posts", "hello")).data).toEqual({ title: "hello" });

    const grant = await moved.plugins.find("acme");
    const original = await service.plugins.find("acme");
    expect(grant?.state).toBe("granted");
    expect(grant?.granted).toEqual(["media:create"]);
    expect(grant?.key_id).toBe(original!.key_id);

    // The managed key rides with the grant that names it, and the ordinary one with `--with-keys`'s rule.
    const keys = (await moved.keys.list()).map((key) => key.id).sort();
    expect(keys).toEqual((await service.keys.list()).map((key) => key.id).sort());
    expect(keys).toContain(original!.key_id!);

    const trail = await moved.audit.list({ limit: 100 });
    const before = await service.audit.list({ limit: 100 });
    const events = (page: typeof trail) =>
      page.items.map((event) => `${event.at} ${event.action} ${event.subject}`);
    expect(before.total).toBeGreaterThan(0);
    expect(trail.total).toBe(before.total);
    expect(events(trail)).toEqual(events(before));
  }

  test("SQLite to the fs driver keeps the grants, every key and the audit log", async () => {
    const destination = await FsStore.open(path.join(tempDir, "destination"));
    try {
      await expectSameInstance(await move(destination));
    } finally {
      await destination.close();
    }
  });

  test.skipIf(!PgTestDatabase.url())("SQLite to Postgres keeps them too", async () => {
    const destination = await PgStore.open({ url: PgTestDatabase.url()!, schema: PgTestDatabase.freshSchema() });
    try {
      await expectSameInstance(await move(destination));
    } finally {
      await destination.close();
      await PgTestDatabase.drop(destination.schema);
    }
  });

  test("an ordinary export still leaves the audit log, the grants and plugin keys behind", async () => {
    const archive = path.join(tempDir, "plain");
    const manifest = await Exporter.exportDir(source, archive, { withKeys: true });
    expect(manifest.instance).toBeUndefined();
    const content = path.join(archive, "projects", Scope.System.project, Scope.System.env, "content");
    const collections = await fs.readdir(content);
    expect(collections).not.toContain(SystemCollections.Audit);
    expect(collections).not.toContain(SystemCollections.Plugins);
  });

  test("a move loads only through the CLI: no key reaches it over HTTP, not even root", async () => {
    const archive = path.join(tempDir, "archive");
    await Exporter.exportDir(source, archive, { instance: true });
    const destination = await SqliteStore.open(path.join(tempDir, "destination.db"));
    try {
      const message = await AsyncChecks.refusal(
        Importer.importDir(destination, archive, { grants: ImportGrants.fromClaims([Claims.Root]) })
      );
      expect(message).toMatch(/moves a whole instance and carries "_system\/_(audit|plugins)"; only "silo import"/);
      expect((await destination.list(Scope.System, SystemCollections.Audit, { limit: 1, offset: 0 })).total).toBe(0);
    } finally {
      await destination.close();
    }
  });

  test("a move is whole: no --include on either side, and no referenced-only media", async () => {
    const acme = TransferSelection.parse(["default"]);
    expect(
      await AsyncChecks.refusal(Exporter.exportDir(source, path.join(tempDir, "a"), { instance: true, include: acme }))
    ).toContain("cannot be combined with --include");
    expect(
      await AsyncChecks.refusal(
        Exporter.exportDir(source, path.join(tempDir, "b"), { instance: true, media: "referenced" })
      )
    ).toContain("--media all or --media none");

    const archive = path.join(tempDir, "archive");
    await Exporter.exportDir(source, archive, { instance: true });
    const destination = await SqliteStore.open(path.join(tempDir, "destination.db"));
    try {
      expect(
        await AsyncChecks.refusal(
          Importer.importDir(destination, archive, { grants: ImportGrants.Trusted, include: acme })
        )
      ).toContain("imports whole; leave out --include");
    } finally {
      await destination.close();
    }
  });

  test("a move is refused while a rename is still in progress", async () => {
    await source.put(entry(Scope.System, SystemCollections.ScopeRenames, "pending", { kind: "project" }), {
      usages: [],
      search: null,
    });
    expect(
      await AsyncChecks.refusal(Exporter.exportDir(source, path.join(tempDir, "archive"), { instance: true }))
    ).toContain("a rename is still in progress");
  });
});

function entry(scope: Scope, collection: string, id: string, data: Record<string, unknown>): Entry {
  const now = new Date(Date.UTC(2026, 0, 1));
  return {
    id,
    project: scope.project,
    env: scope.env,
    collection,
    rev: 1,
    seq: 0,
    created_at: now,
    updated_at: now,
    data,
  };
}
