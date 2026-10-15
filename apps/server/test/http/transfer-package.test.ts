import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { x } from "tar";
import { Claims } from "@silo/shared/claims";
import { MediaRef } from "@silo/shared/media-ref";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import type { Entry } from "../../src/core/domain/entry";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import { MediaPaths } from "../../src/core/media/media-paths";
import { MediaRefs } from "../../src/core/media/media-refs";
import { SiloService } from "../../src/core/services/silo-service";
import type { TransferPackageManifest } from "../../src/core/transfer/package/transfer-package-manifest";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * `POST /api/projects/{p}/envs/{e}/package` (D108): the source half of a
 * cross-instance transfer carries exactly what was picked and the media it
 * uses, and refuses before the first byte rather than sending more or less.
 */
describe("transfer package", () => {
  const source = Scope.of("acme", "dev");
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let root: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-package-test-"));
    store = await SqliteStore.open(path.join(tempDir, "source.db"));
    service = new SiloService(store, { blobStorage: new FsBlobStorage(path.join(tempDir, "media")) });
    await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
    root = (await service.keys.create("root", [Claims.Root])).secret;
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /** Posts pointing at a foldered image, at an image in another folder, and at nothing the source has. */
  const seed = async () => {
    await service.scopes.createProject("acme");
    await service.scopes.createEnvironment("acme", "dev");
    await service.collections.putSchema(source, "posts", { type: "object" });
    await service.collections.putSchema(source, "pages", { type: "object" });
    await service.variables.declare(source, "API_URL", "", "https://dev.example.com");
    for (const folder of ["/a", "/a/b", "/z"]) await service.media.createFolder(folder);

    const used = await service.media.save("used.png", new TextEncoder().encode("used"), "/a/b");
    const other = await service.media.save("other.png", new TextEncoder().encode("other"), "/z");
    await service.media.save("orphan.png", new TextEncoder().encode("orphan"));
    const absent = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";

    const picked = await service.entries.create(source, "posts", { cover: MediaRef.url(used.id) });
    await service.entries.create(source, "posts", { cover: MediaRef.url(other.id) });
    const page = await service.entries.create(source, "pages", { title: "home" });
    // The entry API refuses a reference to an asset that does not exist, so a
    // dangling one arrives the way an imported archive brings it: by `put`.
    const dangling: Entry = {
      id: EntryUtils.newID(),
      project: source.project,
      env: source.env,
      collection: "posts",
      rev: 1,
      seq: 0,
      created_at: new Date(),
      updated_at: new Date(),
      data: { cover: MediaRef.url(absent) },
    };
    await store.put(dangling, { usages: MediaRefs.extract(dangling.data), search: null });
    return { used, absent, picked, dangling, page };
  };

  const request = (body: unknown, secret = root, scope = source) =>
    app.request(`/api/projects/${scope.project}/envs/${scope.env}/package`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  /** The package unpacked: every file's path, and the parsed `package.json`. */
  const unpack = async (response: Response) => {
    expect(response.status).toBe(200);
    const file = path.join(tempDir, "package.tar.gz");
    const directory = path.join(tempDir, "unpacked");
    await fs.writeFile(file, new Uint8Array(await response.arrayBuffer()));
    await fs.mkdir(directory);
    await x({ file, cwd: directory });
    const files = (await fs.readdir(directory, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
      .sort();
    const manifest = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
    return { files, manifest: manifest as TransferPackageManifest };
  };

  const folderId = async (folder: string): Promise<string> => {
    const { items } = await store.list(Scope.System, "_media_folders", { limit: 100, offset: 0 });
    return items.find((item) => item.data.path === folder)!.id;
  };

  test("carries the picked entries, their schema, and the media and folders they use", async () => {
    const { used, absent, picked, dangling } = await seed();

    const { files, manifest } = await unpack(
      await request({ collections: [{ name: "posts", entry_ids: [picked.id, dangling.id] }] })
    );

    const system = "projects/_system/_system";
    expect(files).toEqual(
      [
        "package.json",
        "projects/acme/.silo-project",
        "projects/acme/dev/.silo-env",
        "projects/acme/dev/schemas/posts.schema.json",
        "projects/acme/dev/schemas/.posts.silo-collection",
        `projects/acme/dev/content/posts/${picked.id}.json`,
        `projects/acme/dev/content/posts/${dangling.id}.json`,
        `${system}/schemas/_media.schema.json`,
        `${system}/schemas/._media.silo-collection`,
        `${system}/content/_media/${used.id}.json`,
        `${system}/schemas/_media_folders.schema.json`,
        `${system}/schemas/._media_folders.silo-collection`,
        `${system}/content/_media_folders/${await folderId("/a")}.json`,
        `${system}/content/_media_folders/${await folderId("/a/b")}.json`,
        `media/${MediaPaths.archiveName(used.blob_key)}`,
      ].sort()
    );
    expect(manifest).toMatchObject({
      package_version: 1,
      scope: { project: "acme", env: "dev" },
      media: "referenced",
      collections: [{ name: "posts", entry_ids: [picked.id, dangling.id], entries: 2 }],
      media_assets: 1,
      media_folders: 2,
      missing_media: [absent],
    });
  });

  test("with media none carries no catalog row or byte, and a whole collection carries all of it", async () => {
    const { picked, page } = await seed();

    const { files, manifest } = await unpack(
      await request({
        collections: [{ name: "posts", entry_ids: [picked.id] }, { name: "pages" }],
        media: "none",
      })
    );

    expect(files.filter((file) => file.startsWith("projects/_system") || file.startsWith("media/"))).toEqual([]);
    expect(files).toContain(`projects/acme/dev/content/pages/${page.id}.json`);
    expect(files.filter((file) => file.includes("/content/posts/"))).toEqual([
      `projects/acme/dev/content/posts/${picked.id}.json`,
    ]);
    expect(manifest).toMatchObject({ media: "none", media_assets: 0, media_folders: 0, missing_media: [] });
  });

  const refusals: [string, (seeded: Awaited<ReturnType<typeof seed>>) => unknown, number, string, Scope?][] = [
    ["a collection the environment lacks", () => ({ collections: [{ name: "nope" }] }), 404, "nope"],
    ["an entry the collection lacks", () => ({ collections: [{ name: "posts", entry_ids: ["01MISSING"] }] }), 404, "01MISSING"],
    ["a system collection", () => ({ collections: [{ name: "_keys" }] }), 400, "_keys"],
    ["a collection named twice", () => ({ collections: [{ name: "posts" }, { name: "posts" }] }), 400, "twice"],
    ["the whole media library", () => ({ collections: [{ name: "posts" }], media: "all" }), 400, "media"],
    ["an environment that does not exist", () => ({ collections: [{ name: "posts" }] }), 404, "acme/qa", Scope.of("acme", "qa")],
  ];

  for (const [name, body, status, mentions, scope] of refusals) {
    test(`refuses ${name} before sending anything`, async () => {
      const seeded = await seed();
      const response = await request(body(seeded), root, scope);
      expect(response.status).toBe(status);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(JSON.stringify(await response.json())).toContain(mentions);
    });
  }

  test("asks for transfer:export and read on every collection it names", async () => {
    await seed();
    const read = (collection: string) =>
      Claims.TransferReadPermissions.map((permission) => Claims.collection("acme", "dev", collection, permission));
    const postsReader = (await service.keys.create("posts", [Claims.TransferExport, ...read("posts")])).secret;
    const noTransfer = (await service.keys.create("no transfer", [...read("posts"), ...read("pages")])).secret;

    expect((await request({ collections: [{ name: "posts" }] }, postsReader)).status).toBe(200);
    expect((await request({ collections: [{ name: "posts" }, { name: "pages" }] }, postsReader)).status).toBe(403);
    expect((await request({ collections: [{ name: "posts" }] }, noTransfer)).status).toBe(403);
  });

  test("an ordinary import refuses a package rather than loading part of a collection", async () => {
    const { picked } = await seed();
    const packaged = await request({ collections: [{ name: "posts", entry_ids: [picked.id] }] });

    const response = await app.request("/api/import?mode=replace", {
      method: "POST",
      headers: { Authorization: `Bearer ${root}`, "Content-Type": "application/gzip" },
      body: new Uint8Array(await packaged.arrayBuffer()),
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("transfer package");
    expect((await service.entries.list(source, "posts", { limit: 10, offset: 0 })).total).toBe(3);
  });
});
