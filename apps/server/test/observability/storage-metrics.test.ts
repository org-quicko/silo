import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { StorageMetrics } from "../../src/observability/storage-metrics";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe("local storage metrics", () => {
  test("counts files without following symlinks or exposing paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "silo-observability-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "one"), "1234");
    await fs.writeFile(path.join(root, "nested", "two"), "123456");
    await fs.symlink(os.tmpdir(), path.join(root, "outside"));

    const metrics = new StorageMetrics({ dataDirectory: root, storageDriver: "fs" });
    const snapshot = await metrics.refresh();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.data_directory).toEqual({ bytes: 10, files: 2, truncated: false });
    expect(snapshot.filesystem?.total_bytes).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain(root);
  });

  test("does not count the media library twice when it sits under the data directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "silo-observability-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "media"));
    await fs.writeFile(path.join(root, "silo.db"), "d".repeat(1000));
    await fs.writeFile(path.join(root, "media", "photo.jpg"), "m".repeat(5000));

    // What `config-loader` derives when `[blob_storage] path` is left unset.
    const metrics = new StorageMetrics({
      dataDirectory: root,
      mediaDirectory: path.join(root, "media"),
      storageDriver: "sqlite",
      blobDriver: "fs",
    });
    const snapshot = await metrics.refresh();

    expect(snapshot.data_directory).toEqual({ bytes: 1000, files: 1, truncated: false });
    expect(snapshot.media_directory).toEqual({ bytes: 5000, files: 1, truncated: false });
  });

  test("counts a media library pinned outside the data directory in full", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "silo-observability-"));
    const media = await fs.mkdtemp(path.join(os.tmpdir(), "silo-observability-media-"));
    directories.push(root, media);
    await fs.writeFile(path.join(root, "silo.db"), "d".repeat(1000));
    await fs.writeFile(path.join(media, "photo.jpg"), "m".repeat(5000));

    const snapshot = await new StorageMetrics({
      dataDirectory: root,
      mediaDirectory: media,
      storageDriver: "sqlite",
      blobDriver: "fs",
    }).refresh();

    expect(snapshot.data_directory).toEqual({ bytes: 1000, files: 1, truncated: false });
    expect(snapshot.media_directory).toEqual({ bytes: 5000, files: 1, truncated: false });
  });

  test("reports remote or absent directories as unavailable instead of guessing", () => {
    const snapshot = new StorageMetrics({ storageDriver: "remote", blobDriver: "s3" }).snapshot();
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.data_directory).toBeNull();
    expect(snapshot.media_directory).toBeNull();
  });
});
