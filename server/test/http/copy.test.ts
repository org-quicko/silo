import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { Service } from "../../core/service/service";
import { Scope } from "../../core/domain/scope";
import { SiloServer } from "../../http/server";
import { Logger } from "../../logging/logger";

describe("Server copy API", () => {
  let tempDir: string;
  let sourceStore: SqliteStore;
  let destinationStore: SqliteStore;
  let sourceService: Service;
  let destinationService: Service;
  let sourceServer: ReturnType<typeof Bun.serve>;
  let destinationApp: Hono;
  let sourceKey: string;
  let destinationKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-copy-test-"));
    sourceStore = await SqliteStore.open(path.join(tempDir, "source.db"));
    destinationStore = await SqliteStore.open(path.join(tempDir, "destination.db"));
    sourceService = new Service(sourceStore, {
      blobStore: new FsBlobStorage(path.join(tempDir, "source-media")),
    });
    destinationService = new Service(destinationStore, {
      blobStore: new FsBlobStorage(path.join(tempDir, "destination-media")),
    });
    sourceKey = await sourceService.bootstrap();
    destinationKey = await destinationService.bootstrap();

    const sourceApp = new SiloServer(sourceService, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
    sourceServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: sourceApp.fetch,
    });
    destinationApp = new SiloServer(destinationService, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    sourceServer.stop(true);
    await sourceStore.close();
    await destinationStore.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("previews then replaces data and API keys from the source", async () => {
    await sourceService.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    await destinationService.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    const sourceEntry = await sourceService.createEntry(Scope.Default, "posts", {
      title: "from source",
    });
    const destinationEntry = await destinationService.createEntry(Scope.Default, "posts", {
      title: "from destination",
    });
    const preview = await destinationApp.request("/api/copy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${destinationKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_url: sourceServer.url.toString(),
        source_api_key: sourceKey,
        mode: "replace",
        with_keys: true,
        dry_run: true,
      }),
    });

    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      mode: "replace",
      dry_run: true,
      added: 2,
      deleted: 2,
    });
    expect((await destinationService.getEntry(Scope.Default, "posts", destinationEntry.id)).data.title).toBe("from destination");

    const executed = await destinationApp.request("/api/copy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${destinationKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_url: sourceServer.url.toString(),
        source_api_key: sourceKey,
        mode: "replace",
        with_keys: true,
      }),
    });

    expect(executed.status).toBe(200);
    expect(await executed.json()).toMatchObject({
      mode: "replace",
      dry_run: false,
      added: 2,
      deleted: 2,
    });
    expect((await destinationService.getEntry(Scope.Default, "posts", sourceEntry.id)).data.title).toBe("from source");
    await expect(destinationService.getEntry(Scope.Default, "posts", destinationEntry.id)).rejects.toThrow();
    await expect(destinationService.authenticate(destinationKey)).rejects.toThrow();
    expect((await destinationService.authenticate(sourceKey)).claims).toEqual(["*"]);
  });

  test("rejects a source key without export claims", async () => {
    const { secret: readKey } = await sourceService.createKey("reader", [
      Claims.collection(Claims.Root, Claims.Root, Claims.Root, Claims.CollectionEntriesRead),
    ]);
    const response = await destinationApp.request("/api/copy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${destinationKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_url: sourceServer.url.toString(),
        source_api_key: readKey,
        mode: "merge",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: "source silo key must permit export" },
    });
  });

  test("merges data without changing destination API keys", async () => {
    await sourceService.putSchema(Scope.Default, "notes", { type: "object" });
    const sourceEntry = await sourceService.createEntry(Scope.Default, "notes", { text: "copied" });

    const response = await destinationApp.request("/api/copy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${destinationKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_url: sourceServer.url.toString(),
        source_api_key: sourceKey,
        mode: "merge",
        with_keys: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "merge", added: 1 });
    expect((await destinationService.getEntry(Scope.Default, "notes", sourceEntry.id)).data.text).toBe("copied");
    expect((await destinationService.authenticate(destinationKey)).claims).toEqual(["*"]);
    await expect(destinationService.authenticate(sourceKey)).rejects.toThrow();
  });
});
