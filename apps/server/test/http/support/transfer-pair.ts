import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { MediaRef } from "@silo/shared/media-ref";
import { FsBlobStorage } from "../../../src/adapters/blob/fs-blob-storage";
import { FsStore } from "../../../src/adapters/storage/fs/fs-store";
import { PgStore } from "../../../src/adapters/storage/postgres/pg-store";
import { SqliteStore } from "../../../src/adapters/storage/sqlite/sqlite-store";
import type { TransferConfig } from "../../../src/config/transfer-config";
import type { Entry } from "../../../src/core/domain/entry";
import { Scope } from "../../../src/core/domain/scope";
import type { MediaAsset } from "../../../src/core/media/media-asset";
import { MediaCatalog } from "../../../src/core/media/media-catalog";
import type { BlobStorage } from "../../../src/core/ports/blob-storage";
import type { Storage } from "../../../src/core/ports/storage";
import { SiloService } from "../../../src/core/services/silo-service";
import { SiloServer } from "../../../src/http/server";
import { Logger } from "../../../src/logging/logger";
import { PgTestDatabase } from "../../adapters/support/pg-test-database";

/** What the in-process destination answers with. */
type Answer = Awaited<ReturnType<Hono["request"]>>;

/**
 * Two real instances for transfer tests (D109, D111): a source on a port,
 * serving `acme/dev`, and a destination answered in process, holding
 * `acme/uat` and `acme/dev`. Both run with authentication on.
 */
export class TransferPair {
  static readonly Prepare = "/api/projects/acme/envs/uat/transfers";

  readonly tempDir: string;
  readonly staging: string;
  readonly sourceService: SiloService;
  readonly destinationService: SiloService;
  readonly destination: Hono;
  readonly sourceKey: string;
  readonly destinationKey: string;
  seeded!: { picked: string; other: string; home: string; asset: string };
  private readonly sourceServer: ReturnType<typeof Bun.serve>;
  private readonly stores: Storage[];
  private readonly servers: ReturnType<typeof Bun.serve>[] = [];

  private constructor(
    tempDir: string,
    sourceService: SiloService,
    destinationService: SiloService,
    keys: { source: string; destination: string },
    sourceServer: ReturnType<typeof Bun.serve>,
    stores: Storage[]
  ) {
    this.tempDir = tempDir;
    this.staging = path.join(tempDir, "destination-transfer");
    this.sourceService = sourceService;
    this.destinationService = destinationService;
    this.destination = TransferPair.app(destinationService);
    this.sourceKey = keys.source;
    this.destinationKey = keys.destination;
    this.sourceServer = sourceServer;
    this.stores = stores;
  }

  static async open(
    options: {
      destination?: "sqlite" | "fs" | "postgres";
      /** The destination's blob store, made in the pair's own directory. */
      blobs?: (directory: string) => BlobStorage;
      transfer?: TransferConfig;
      /** Where both instances keep their files, so another process can open the destination's. */
      directory?: string;
    } = {}
  ): Promise<TransferPair> {
    const tempDir = options.directory ?? (await fs.mkdtemp(path.join(os.tmpdir(), "silo-prepared-test-")));
    const sourceStore = await SqliteStore.open(path.join(tempDir, "source.db"));
    const destinationStore = await TransferPair.destinationStore(options.destination ?? "sqlite", tempDir);
    const sourceService = new SiloService(sourceStore, { blobStorage: new FsBlobStorage(path.join(tempDir, "source-media")) });
    const destinationService = new SiloService(destinationStore, {
      blobStorage: options.blobs?.(tempDir) ?? new FsBlobStorage(path.join(tempDir, "destination-media")),
      stagingDir: path.join(tempDir, "destination-transfer"),
      transfer: options.transfer,
    });
    const sourceServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: TransferPair.app(sourceService).fetch });
    const keys = { source: await sourceService.keys.bootstrap(), destination: await destinationService.keys.bootstrap() };
    return new TransferPair(tempDir, sourceService, destinationService, keys, sourceServer, [sourceStore, destinationStore]);
  }

  static app(service: SiloService): Hono {
    return new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  }

  get sourceUrl(): string {
    return this.sourceServer.url.toString();
  }

  async close(): Promise<void> {
    for (const server of [this.sourceServer, ...this.servers]) server.stop(true);
    for (const store of this.stores) await store.close();
    for (const store of this.stores) if (store instanceof PgStore) await PgTestDatabase.drop(store.schema);
    await fs.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }

  /** Source `acme/dev`: two posts, one pointing at an image in `/a`, and a page. */
  async seed(): Promise<void> {
    const source = this.sourceService;
    const dev = Scope.of("acme", "dev");
    await source.scopes.createProject("acme");
    await source.scopes.createEnvironment("acme", "dev");
    await source.collections.putSchema(dev, "posts", { type: "object" });
    await source.collections.putSchema(dev, "pages", { type: "object" });
    await source.media.createFolder("/a");
    const asset = await source.media.save("used.png", new TextEncoder().encode("used"), "/a");
    const picked = await source.entries.create(dev, "posts", { title: "picked", cover: MediaRef.url(asset.id) });
    const other = await source.entries.create(dev, "posts", { title: "other" });
    const home = await source.entries.create(dev, "pages", { title: "home" });
    this.seeded = { picked: picked.id, other: other.id, home: home.id, asset: asset.id };

    await this.destinationService.scopes.createProject("acme");
    await this.destinationService.scopes.createEnvironment("acme", "uat");
    await this.destinationService.scopes.createEnvironment("acme", "dev");
  }

  /** A prepare body for the picked post and every page, with `overrides` on top. */
  body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      source: { url: this.sourceUrl, api_key: this.sourceKey },
      from: { project: "acme", env: "dev" },
      selection: [{ collection: "posts", entry_ids: [this.seeded.picked] }, { collection: "pages" }],
      ...overrides,
    };
  }

  async prepare(body: Record<string, unknown>, key = this.destinationKey, headers: Record<string, string> = {}): Promise<Answer> {
    return await this.destination.request(TransferPair.Prepare, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  async apply(id: string, key = this.destinationKey, headers: Record<string, string> = {}): Promise<Answer> {
    return await this.destination.request(`${TransferPair.Prepare}/${id}/apply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, ...headers },
    });
  }

  async call(method: string, route: string, key = this.destinationKey): Promise<Answer> {
    return await this.destination.request(route, { method, headers: { Authorization: `Bearer ${key}` } });
  }

  /** A server of the test's own, stopped by `close`. */
  serve(fetch: (request: Request) => Response | Promise<Response>): string {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
    this.servers.push(server);
    return server.url.toString();
  }

  /** The transfer folders the destination holds on disk. */
  async transferDirectories(): Promise<string[]> {
    return fs.readdir(path.join(this.staging, "prepared")).catch(() => []);
  }

  /** A destination row with the id and time a test needs, put as an import would. */
  async plant(env: string, collection: string, id: string, updatedAt: string, rev = 1, data: unknown = {}): Promise<void> {
    const at = new Date(updatedAt);
    const entry: Entry = { id, project: "acme", env, collection, rev, seq: 0, created_at: at, updated_at: at, data };
    await this.destinationService.store.put(entry, { usages: [], search: null });
  }

  /** A destination asset under `id`, as an earlier transfer or import would leave it. */
  async plantAsset(id: string, bytes: string, details: Partial<MediaAsset> = {}): Promise<void> {
    const data = new TextEncoder().encode(bytes);
    const asset: MediaAsset = {
      filename: "used.png",
      folder: "/a",
      blob_key: `media/${id}`,
      size: data.length,
      content_type: "image/png",
      hash: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
      state: "active",
      tags: [],
      ...details,
    };
    await this.destinationService.blobStorage.put(asset.blob_key, data);
    const at = new Date();
    const row: Entry = { id, project: Scope.System.project, env: Scope.System.env, collection: MediaCatalog.Collection, rev: 1, seq: 0, created_at: at, updated_at: at, data: asset };
    await this.destinationService.store.put(row, { usages: [], search: null });
  }

  /** Everything the destination holds, as an export writes it, and every file in its blob store. */
  async snapshot(): Promise<{ files: Record<string, string>; blobs: string[] }> {
    const directory = await fs.mkdtemp(path.join(this.tempDir, "snapshot-"));
    try {
      await this.destinationService.transfer.exportDir(directory, {});
      const files: Record<string, string> = {};
      for await (const name of new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true, dot: true })) {
        if (name !== "manifest.json") files[name.replaceAll("\\", "/")] = await Bun.file(path.join(directory, name)).text();
      }
      const blobs = (await this.destinationService.blobStorage.list()).map((item) => item.key).sort();
      return { files, blobs };
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  private static async destinationStore(kind: "sqlite" | "fs" | "postgres", tempDir: string): Promise<Storage> {
    if (kind === "fs") return FsStore.open(path.join(tempDir, "destination-fs"));
    if (kind === "postgres") return PgStore.open({ url: PgTestDatabase.url()!, schema: PgTestDatabase.freshSchema() });
    return SqliteStore.open(path.join(tempDir, "destination.db"));
  }
}
