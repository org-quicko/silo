import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * Who may run a **narrowed** transfer (D74/§7.6).
 *
 * With no selection the archive routes still demand instance-wide authority —
 * `transfer:export` alone would otherwise hand a key confined to one project a
 * way straight out of it. With one they ask only for what the rules name, which
 * is the rule the scoped copy route has used since D22.
 */
describe("selective transfer authority", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-transfer-auth-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, {
      blobStorage: new FsBlobStorage(path.join(tempDir, "media")),
    });
    await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();

    await service.scopes.createProject("site");
    await service.scopes.createEnvironment("site", "prod");
    await service.scopes.createProject("shop");
    await service.scopes.createEnvironment("shop", "prod");
    await service.collections.putSchema(Scope.of("site", "prod"), "posts", { type: "object" });
    await service.collections.putSchema(Scope.of("shop", "prod"), "orders", { type: "object" });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /** A key that can read one project and nothing else. */
  const projectReader = async (project: string): Promise<string> => {
    const { secret } = await service.keys.create(`${project} reader`, [
      Claims.TransferExport,
      ...Claims.TransferReadPermissions.map((permission) =>
        Claims.collection(project, "*", "*", permission),
      ),
    ]);
    return secret;
  };

  const exportWith = (secret: string, query: string) =>
    app.request(`/api/export${query}`, { headers: { Authorization: `Bearer ${secret}` } });

  test("a project-scoped key may export its own project", async () => {
    const secret = await projectReader("site");
    expect((await exportWith(secret, "?include=site")).status).toBe(200);
    expect((await exportWith(secret, "?include=site/prod")).status).toBe(200);
    expect((await exportWith(secret, "?include=site/prod/posts")).status).toBe(200);
  });

  test("and may not export anyone else's, or the instance", async () => {
    const secret = await projectReader("site");
    expect((await exportWith(secret, "?include=shop")).status).toBe(403);
    expect((await exportWith(secret, "?include=site&include=shop")).status).toBe(403);
    // No selection is still the whole instance, so it still needs `*/*/*`.
    expect((await exportWith(secret, "")).status).toBe(403);
  });

  test("keys are instance-global, so with_keys is not narrowed by a selection", async () => {
    const { secret } = await service.keys.create("site reader with keys", [
      Claims.TransferExport,
      Claims.KeysExport,
      ...Claims.TransferReadPermissions.map((permission) =>
        Claims.collection("site", "*", "*", permission),
      ),
    ]);
    expect((await exportWith(secret, "?include=site")).status).toBe(200);
    expect((await exportWith(secret, "?include=site&with_keys=true")).status).toBe(403);
  });

  test("the transfer claim is still necessary on top of the reach", async () => {
    const { secret } = await service.keys.create("site reader", [
      ...Claims.TransferReadPermissions.map((permission) =>
        Claims.collection("site", "*", "*", permission),
      ),
    ]);
    expect((await exportWith(secret, "?include=site")).status).toBe(403);
  });

  test("a malformed rule is a 400 before any storage is read", async () => {
    const { secret } = await service.keys.create("root-ish", [Claims.Root]);
    expect((await exportWith(secret, "?include=site/prod/posts/extra")).status).toBe(400);
    expect((await exportWith(secret, "?include=site/prod/_keys")).status).toBe(400);
    expect((await exportWith(secret, "?media=some")).status).toBe(400);
  });

  test("media:create is asked for only when bytes are actually loaded", async () => {
    // An import running with `media=none` writes nothing into the library, so
    // asking for the claim would refuse a request that touches no media at all.
    const withoutMedia = await service.keys.create("importer without media", [
      Claims.TransferImport,
      ...Claims.TransferWritePermissions.map((permission) =>
        Claims.collection("*", "*", "*", permission),
      ),
    ]);
    const post = (query: string) =>
      app.request(`/api/import${query}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${withoutMedia.secret}`,
          "Content-Type": "application/gzip",
        },
        body: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
      });

    expect((await post("?dry_run=true")).status).toBe(403);
    // Past the claim gate, so it fails on the truncated archive instead.
    expect((await post("?dry_run=true&media=none")).status).not.toBe(403);
  });
});
