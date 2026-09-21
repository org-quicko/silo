import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";

/**
 * The write lock covers the load and not the upload (D85). The 2026-09-18
 * audit's H5: `importTarGzStream` spooled, unpacked and loaded inside one
 * `withWriteLock`, so a caller holding `transfer:import` who sent the archive
 * slowly held every write on the instance for as long as they liked.
 */
describe("an arriving archive holds no lock", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-transfer-lock-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, {
      mediaDir: path.join(tempDir, "media"),
      stagingDir: path.join(tempDir, "transfer"),
    });
    await service.collections.putSchema(Scope.Default, "posts", { type: "object" });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("a write lands while an upload is still arriving", async () => {
    // An upload that has sent nothing yet and will not until released.
    let release!: () => void;
    const stalled = new ReadableStream<Uint8Array>({
      pull(controller) {
        return new Promise<void>((resolve) => {
          release = () => {
            controller.enqueue(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]));
            controller.close();
            resolve();
          };
        });
      },
    });

    const importing = service.transfer.importTarGzStream(stalled, { mode: "merge" });
    importing.catch(() => {});

    // With the lock held from the first byte this never settled; two seconds
    // is far longer than an entry write takes and far shorter than the run.
    const written = await Promise.race([
      service.entries.create(Scope.Default, "posts", { title: "meanwhile" }),
      new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 2000)),
    ]);
    expect(written).not.toBe("stuck");

    // Then let the upload finish, as the truncated archive it is.
    release();
    await importing.catch(() => {});
    await expect(importing).rejects.toThrow();
    // The staging directory it opened is gone with it.
    expect(await fs.readdir(path.join(tempDir, "transfer"))).toEqual([]);
  });
});
