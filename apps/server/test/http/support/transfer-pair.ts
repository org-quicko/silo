import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { MediaRef } from "@silo/shared/media-ref";
import { FsBlobStorage } from "../../../src/adapters/blob/fs-blob-storage";
import { FsStore } from "../../../src/adapters/storage/fs/fs-store";
import { SqliteStore } from "../../../src/adapters/storage/sqlite/sqlite-store";
import type { TransferConfig } from "../../../src/config/transfer-config";
import { Scope } from "../../../src/core/domain/scope";
import type { Storage } from "../../../src/core/ports/storage";
import { SiloService } from "../../../src/core/services/silo-service";
import { SiloServer } from "../../../src/http/server";
import { Logger } from "../../../src/logging/logger";

/** What the in-process destination answers with. */
type Answer = Awaited<ReturnType<Hono["request"]>>;

/**
 * Two real instances for transfer tests (D109): a source on a port, serving
 * `acme/dev`, and a destination answered in process, holding `acme/uat` and
 * `acme/dev`. Both run with authentication on.
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

  static async open(options: { destination?: "sqlite" | "fs"; transfer?: TransferConfig } = {}): Promise<TransferPair> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-prepared-test-"));
    const sourceStore = await SqliteStore.open(path.join(tempDir, "source.db"));
    const destinationStore =
      options.destination === "fs"
        ? await FsStore.open(path.join(tempDir, "destination-fs"))
        : await SqliteStore.open(path.join(tempDir, "destination.db"));
    const sourceService = new SiloService(sourceStore, { blobStorage: new FsBlobStorage(path.join(tempDir, "source-media")) });
    const destinationService = new SiloService(destinationStore, {
      blobStorage: new FsBlobStorage(path.join(tempDir, "destination-media")),
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
}
