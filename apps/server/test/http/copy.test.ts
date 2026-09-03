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
import { HttpSiloClient } from "../../src/adapters/http/http-silo-client";

describe("Server copy API", () => {
  let tempDir: string;
  let sourceStore: SqliteStore;
  let destinationStore: SqliteStore;
  let sourceService: SiloService;
  let destinationService: SiloService;
  let sourceServer: ReturnType<typeof Bun.serve>;
  let destinationApp: Hono;
  let sourceKey: string;
  let destinationKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-copy-test-"));
    sourceStore = await SqliteStore.open(path.join(tempDir, "source.db"));
    destinationStore = await SqliteStore.open(path.join(tempDir, "destination.db"));
    sourceService = new SiloService(sourceStore, {
      blobStorage: new FsBlobStorage(path.join(tempDir, "source-media")),
    });
    destinationService = new SiloService(destinationStore, {
      blobStorage: new FsBlobStorage(path.join(tempDir, "destination-media")),
    });
    sourceKey = await sourceService.keys.bootstrap();
    destinationKey = await destinationService.keys.bootstrap();

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
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("previews then replaces data and API keys from the source", async () => {
    await sourceService.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    await destinationService.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    const sourceEntry = await sourceService.entries.create(Scope.Default, "posts", {
      title: "from source",
    });
    const destinationEntry = await destinationService.entries.create(Scope.Default, "posts", {
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
    expect((await destinationService.entries.get(Scope.Default, "posts", destinationEntry.id)).data.title).toBe("from destination");

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
    expect((await destinationService.entries.get(Scope.Default, "posts", sourceEntry.id)).data.title).toBe("from source");
    await expect(destinationService.entries.get(Scope.Default, "posts", destinationEntry.id)).rejects.toThrow();
    await expect(destinationService.keys.authenticate(destinationKey)).rejects.toThrow();
    expect((await destinationService.keys.authenticate(sourceKey)).claims).toEqual(["*"]);
  });

  test("rejects a source key without export claims", async () => {
    const { secret: readKey } = await sourceService.keys.create("reader", [
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
    await sourceService.collections.putSchema(Scope.Default, "notes", { type: "object" });
    const sourceEntry = await sourceService.entries.create(Scope.Default, "notes", { text: "copied" });

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
    expect((await destinationService.entries.get(Scope.Default, "notes", sourceEntry.id)).data.text).toBe("copied");
    expect((await destinationService.keys.authenticate(destinationKey)).claims).toEqual(["*"]);
    await expect(destinationService.keys.authenticate(sourceKey)).rejects.toThrow();
  });
});

describe("the copy source client", () => {
  const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

  const clientFor = (response: Response) =>
    new HttpSiloClient("http://source.invalid", "key", async () => response);

  const drain = async (stream: ReadableStream<Uint8Array>): Promise<Buffer> => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  };

  test("hands back every byte, including the one it peeked at", async () => {
    // The empty-archive check reads the first chunk before answering, so the
    // bytes it consumed have to reappear at the head of the stream — a peek
    // that forgot to put them back would corrupt every copy.
    const chunks = [
      new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
    ];
    const client = clientFor(new Response(streamOf(chunks), { status: 200 }));

    const archive = await drain(await client.exportArchiveStream(false));
    expect([...archive]).toEqual([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5]);
  });

  test("refuses an archive with no bytes in it", async () => {
    const client = clientFor(new Response(streamOf([]), { status: 200 }));
    await expect(client.exportArchiveStream(false)).rejects.toThrow(
      "empty export archive"
    );
  });

  test("refuses an archive that is only empty chunks", async () => {
    // A zero-length chunk is not the end of a stream, so the check keeps
    // pulling rather than reading one and calling the archive non-empty.
    const client = clientFor(
      new Response(streamOf([new Uint8Array(), new Uint8Array()]), { status: 200 })
    );
    await expect(client.exportArchiveStream(false)).rejects.toThrow(
      "empty export archive"
    );
  });

  test("sees past leading empty chunks to the bytes behind them", async () => {
    const client = clientFor(
      new Response(streamOf([new Uint8Array(), new Uint8Array([7, 8])]), { status: 200 })
    );
    const archive = await drain(await client.exportArchiveStream(false));
    expect([...archive]).toEqual([7, 8]);
  });

  test("still reports a source that refused the export", async () => {
    const client = clientFor(
      new Response(JSON.stringify({ error: { message: "nope" } }), { status: 403 })
    );
    await expect(client.exportArchiveStream(false)).rejects.toThrow(
      "source silo key must permit export"
    );
  });
});
