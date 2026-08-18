import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { Service } from "../../core/service/service";
import crypto from "crypto";

describe("media storage", () => {
  let tempDir: string;
  let store: SqliteStore;
  let mediaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    mediaDir = path.join(tempDir, "media");
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("saving and listing media with hashing", async () => {
    const svc = new Service(store, { mediaDir });
    const content = new TextEncoder().encode("hello world media");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    const meta = await svc.saveMedia("my photo.png", content);
    expect(meta.hash).toBe(expectedHash);
    expect(meta.filename).toBe("my-photo.png");
    expect(meta.url).toBe(`/media/${expectedHash}_my-photo.png`);

    // Verify it is on disk
    const diskPath = path.join(mediaDir, `${expectedHash}_my-photo.png`);
    const fileContent = await fs.readFile(diskPath);
    // Fetch media via getMedia
    const diskFilename = `${expectedHash}_my-photo.png`;
    const fetched = await svc.getMedia(diskFilename);
    expect(fetched).not.toBeNull();
    expect(fetched!.data).toEqual(content);
    expect(fetched!.contentType).toBe("image/png");
  });


  test("deleting media files", async () => {
    const svc = new Service(store, { mediaDir });
    const content = new TextEncoder().encode("file to delete");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    const meta = await svc.saveMedia("delete-me.txt", content);
    const diskFilename = `${expectedHash}_delete-me.txt`;

    // Ensure it exists
    let list = await svc.listMedia();
    expect(list.length).toBe(1);

    // Delete
    await svc.deleteMedia(diskFilename);

    // Ensure it is gone
    list = await svc.listMedia();
    expect(list.length).toBe(0);
  });

  test("export/import round trip preserves media", async () => {
    const svcSrc = new Service(store, { mediaDir });
    const content = new TextEncoder().encode("portable content file");
    await svcSrc.saveMedia("portable.txt", content);

    // Run export
    const exportDest = path.join(tempDir, "export-dir");
    await svcSrc.exportDir(exportDest, { withKeys: false });

    // Ensure media exists in export directory
    const exportMediaDir = path.join(exportDest, "media");
    const exportedFiles = await fs.readdir(exportMediaDir);
    expect(exportedFiles.length).toBe(1);

    // Create another service (dest) with empty database and mediaDir
    const destDbPath = path.join(tempDir, "dest.db");
    const storeDest = await SqliteStore.open(destDbPath);
    const mediaDirDest = path.join(tempDir, "media-dest");
    const svcDest = new Service(storeDest, { mediaDir: mediaDirDest });

    // Import from exportDest
    await svcDest.importDir(exportDest, { mode: "merge" });

    // Ensure media was copied to dest mediaDir
    const destMediaList = await svcDest.listMedia();
    expect(destMediaList.length).toBe(1);
    expect(destMediaList[0].filename).toBe("portable.txt");

    await storeDest.close();
  });
});
