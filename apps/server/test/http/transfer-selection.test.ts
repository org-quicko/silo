import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaRef } from "@silo/shared/media-ref";
import type { ExportManifest } from "../../src/core/transfer/export-manifest";
import { MediaPaths } from "../../src/core/media/media-paths";
import { MediaModes } from "../../src/core/transfer/media-mode";
import { TransferSelection } from "../../src/core/transfer/transfer-selection";

/**
 * Selective export and the media modes (§7.6, §7.7), through the service rather
 * than over HTTP: the routes only parse `include` and `media` into these.
 */
describe("selective transfer", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-selective-test-"));
    store = await SqliteStore.open(path.join(tempDir, "source.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /**
   * Two projects, each with a collection whose entry points at its own image,
   * plus one image nothing references at all.
   */
  const seed = async () => {
    const mediaSchema = {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    };
    await service.scopes.createProject("site");
    await service.scopes.createEnvironment("site", "prod");
    await service.scopes.createProject("shop");
    await service.scopes.createEnvironment("shop", "prod");

    const siteScope = Scope.of("site", "prod");
    const shopScope = Scope.of("shop", "prod");
    await service.collections.putSchema(siteScope, "posts", mediaSchema);
    await service.collections.putSchema(siteScope, "pages", { type: "object" });
    await service.collections.putSchema(shopScope, "orders", mediaSchema);

    const sitePhoto = await service.media.save("site.png", new TextEncoder().encode("site bytes"));
    const shopPhoto = await service.media.save("shop.png", new TextEncoder().encode("shop bytes"));
    const orphan = await service.media.save("orphan.png", new TextEncoder().encode("nobody"));

    await service.entries.create(siteScope, "posts", { cover: MediaRef.url(sitePhoto.id) });
    await service.entries.create(siteScope, "pages", {});
    await service.entries.create(shopScope, "orders", { cover: MediaRef.url(shopPhoto.id) });

    return { sitePhoto, shopPhoto, orphan };
  };

  const exportTo = async (name: string, options: Record<string, unknown>) => {
    const destination = path.join(tempDir, name);
    const manifest = await service.transfer.exportDir(destination, options);
    return { destination, manifest: manifest as ExportManifest };
  };

  const names = async (directory: string): Promise<string[]> => {
    try {
      return (await fs.readdir(directory)).sort();
    } catch {
      return [];
    }
  };

  test("a whole export carries every project, and every blob including the orphan", async () => {
    await seed();
    const { destination, manifest } = await exportTo("whole", {});

    // `_system` is a project directory in the tree; `default` is absent because
    // this store was opened directly rather than through the CLI that seeds it.
    expect(await names(path.join(destination, "projects"))).toEqual(["_system", "shop", "site"]);
    expect(manifest.selection).toBeUndefined();
    expect(manifest.media?.mode).toBe(MediaModes.All);
    // The unreferenced upload rides: "export everything" has to stay lossless.
    expect(manifest.media?.files).toBe(3);
    expect((await names(path.join(destination, "media"))).length).toBe(3);
  });

  test("a collection rule carries that collection alone", async () => {
    await seed();
    const { destination, manifest } = await exportTo("one-collection", {
      include: TransferSelection.parse(["site/prod/posts"]),
    });

    expect(await names(path.join(destination, "projects"))).toEqual(["_system", "site"]);
    expect(await names(path.join(destination, "projects/site/prod/content"))).toEqual(["posts"]);
    expect(manifest.selection).toEqual(["site/prod/posts"]);
    expect(manifest.collections?.["site/prod/posts"]).toBe(1);
    expect(manifest.collections?.["site/prod/pages"]).toBeUndefined();
  });

  test("a narrowed export defaults to the media its entries actually point at", async () => {
    const { sitePhoto } = await seed();
    const { destination, manifest } = await exportTo("narrow-media", {
      include: TransferSelection.parse(["site/prod/posts"]),
    });

    expect(manifest.media?.mode).toBe(MediaModes.Referenced);
    expect(manifest.media?.referenced).toBe(1);
    expect(manifest.media?.files).toBe(1);
    // Flat, prefix stripped: the archive keeps the layout D23 fixed (D88).
    expect(await names(path.join(destination, "media"))).toEqual([
      MediaPaths.archiveName(sitePhoto.blob_key),
    ]);
  });

  test("media none carries the catalog and not one byte", async () => {
    await seed();
    const { destination, manifest } = await exportTo("no-bytes", { media: MediaModes.None });

    expect(manifest.media?.files).toBe(0);
    // The catalog still rides, so filenames, folders and URLs survive for a
    // destination whose bytes are already in place — the shared-bucket case.
    expect(manifest.media?.catalogued).toBe(3);
    expect(await names(path.join(destination, "media"))).toEqual([]);
    expect(
      (await names(path.join(destination, "projects/_system/_system/content/_media"))).length
    ).toBe(3);
  });

  test("variables follow their project, because they are keyed by it", async () => {
    await seed();
    await service.variables.declare(Scope.of("site", "prod"), "SITE_URL");
    await service.variables.declare(Scope.of("shop", "prod"), "SHOP_URL");

    const { destination } = await exportTo("vars", {
      include: TransferSelection.parse(["site"]),
    });
    const declarations = await names(
      path.join(destination, "projects/_system/_system/content/_variables")
    );
    expect(declarations.length).toBe(1);
  });

  test("a selective export is still importable, and lands only what it carried", async () => {
    const { sitePhoto } = await seed();
    const { destination } = await exportTo("portable", {
      include: TransferSelection.parse(["site/prod/posts"]),
    });

    const destinationStore = await SqliteStore.open(path.join(tempDir, "destination.db"));
    const destinationService = new SiloService(destinationStore, {
      mediaDir: path.join(tempDir, "media-destination"),
    });
    try {
      const result = await destinationService.transfer.importDir(destination, { mode: "merge" });
      // The entry, plus the one `_media` catalog row that describes its image.
      expect(result.added).toBe(2);
      expect(result.media?.files).toBe(1);
      expect(
        (await destinationService.entries.list(Scope.of("site", "prod"), "posts", {})).total
      ).toBe(1);

      const restored = await destinationService.media.list();
      expect(restored.total).toBe(1);
      expect(restored.items[0]!.id).toBe(sitePhoto.id);
      expect(
        (await destinationService.collections.list(Scope.of("site", "prod"))).map((c) => c.name)
      ).toEqual(["posts"]);
    } finally {
      await destinationStore.close();
    }
  });
  test("replace of a partial archive does not empty the destination library", async () => {
    // The bug a granular export would otherwise have created: replace mode used
    // to clear every blob whenever the archive had a `media/` directory, which
    // for a one-collection archive means wiping a library to restore the
    // handful of files that collection happened to reference (§7.7).
    const { sitePhoto } = await seed();
    const { destination } = await exportTo("partial", {
      include: TransferSelection.parse(["site/prod/posts"]),
    });

    const destinationStore = await SqliteStore.open(path.join(tempDir, "keeper.db"));
    const destinationService = new SiloService(destinationStore, {
      mediaDir: path.join(tempDir, "media-keeper"),
    });
    try {
      const keeper = await destinationService.media.save(
        "keeper.png",
        new TextEncoder().encode("must survive")
      );

      const result = await destinationService.transfer.importDir(destination, { mode: "replace" });
      expect(result.media?.cleared).toBe(false);

      const ids = (await destinationService.media.list()).items.map((asset) => asset.id).sort();
      expect(ids).toEqual([keeper.id, sitePhoto.id].sort());
      expect(await destinationService.media.bytes(keeper.id)).not.toBeNull();
    } finally {
      await destinationStore.close();
    }
  });

  test("replace of a whole archive is still authoritative for the library", async () => {
    await seed();
    const { destination } = await exportTo("whole-replace", {});

    const destinationStore = await SqliteStore.open(path.join(tempDir, "replaced.db"));
    const destinationService = new SiloService(destinationStore, {
      mediaDir: path.join(tempDir, "media-replaced"),
    });
    try {
      const stale = await destinationService.media.save(
        "stale.png",
        new TextEncoder().encode("should go")
      );
      const result = await destinationService.transfer.importDir(destination, { mode: "replace" });

      expect(result.media?.cleared).toBe(true);
      expect(await destinationService.media.bytes(stale.id)).toBeNull();
      expect((await destinationService.media.list()).total).toBe(3);
    } finally {
      await destinationStore.close();
    }
  });
});
