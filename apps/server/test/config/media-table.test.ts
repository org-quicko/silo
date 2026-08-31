import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { TOML } from "bun";
import { ConfigLoader } from "../../src/config/config-loader";
import { MediaTable } from "../../src/config/media-table";

/**
 * Reading and rewriting `[media]` (D46).
 *
 * `BlobStorageTable`'s tests with a different table, because both go through
 * `TomlTableEdit` and the property that matters is its: the edit is text, so
 * everything outside the table survives, and it is abandoned rather than saved
 * if anything else moved.
 */
describe("MediaTable", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-table-"));
    configPath = path.join(dir, "silo.toml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("a file with no [media] reads as nothing, not as the defaults", async () => {
    await fs.writeFile(configPath, 'listen = ":8090"\n', "utf8");
    expect(await MediaTable.read(configPath)).toBeNull();
  });

  test("a partial table reads back as exactly the fields it set", async () => {
    await fs.writeFile(configPath, '[media]\nbase_url = "https://cdn.example.com"\n', "utf8");
    expect(await MediaTable.read(configPath)).toEqual({ base_url: "https://cdn.example.com" });
  });

  test("a write round-trips through the loader", async () => {
    await MediaTable.write(configPath, {
      base_url: "https://cms.example.com",
      base_url_target: "store",
      extensions: ["jpg", "png"],
    });

    const loaded = await ConfigLoader.loadConfig(configPath, true);
    expect(loaded.media).toEqual({
      base_url: "https://cms.example.com",
      base_url_target: "store",
      extensions: ["jpg", "png"],
    });
  });

  test("an unset base URL is left out, so the request's origin keeps deciding", async () => {
    await MediaTable.write(configPath, { base_url_target: "server", extensions: ["png"] });
    const text = await fs.readFile(configPath, "utf8");
    expect(text).not.toContain("base_url ");
    expect((TOML.parse(text) as any).media.base_url).toBeUndefined();
  });

  test("every other table and every comment outside this one survives", async () => {
    await fs.writeFile(
      configPath,
      [
        "# my instance",
        'listen = ":9000"',
        "",
        "[storage]",
        'driver = "sqlite"  # keep this comment',
        "",
        "[media]",
        'base_url = "https://old.example.com"',
        "",
        "[auth]",
        "disabled = false",
        "",
      ].join("\n"),
      "utf8"
    );

    await MediaTable.write(configPath, { base_url_target: "server", extensions: ["png"] });

    const text = await fs.readFile(configPath, "utf8");
    expect(text).toContain("# my instance");
    expect(text).toContain('driver = "sqlite"  # keep this comment');
    expect(text).not.toContain("old.example.com");

    const parsed = TOML.parse(text) as any;
    expect(parsed.listen).toBe(":9000");
    expect(parsed.auth.disabled).toBe(false);
    expect(parsed.media.extensions).toEqual(["png"]);
  });

  test("writing to a file that is not there creates one and says so", async () => {
    const created = await MediaTable.write(configPath, {
      base_url_target: "server",
      extensions: ["png"],
    });
    expect(created).toBe(true);
    expect((await MediaTable.read(configPath))?.extensions).toEqual(["png"]);
  });

  test("[blob_storage] and [media] can be written to the same file in either order", async () => {
    // Two managed tables in one document is what `TomlTableEdit` was extracted
    // for, and the way it goes wrong is one span running into the other.
    const { BlobStorageTable } = await import("../../src/config/blob-storage-table");

    await MediaTable.write(configPath, { base_url_target: "store", extensions: ["png"] });
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "b" });
    await MediaTable.write(configPath, { base_url_target: "server", extensions: ["jpg"] });

    const loaded = await ConfigLoader.loadConfig(configPath, true);
    expect(loaded.blob_storage.bucket).toBe("b");
    expect(loaded.media).toEqual({ base_url_target: "server", extensions: ["jpg"] });
  });
});
