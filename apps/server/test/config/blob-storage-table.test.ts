import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { InitCommand } from "../../src/cli/commands/init-command";
import { BlobStorageTable } from "../../src/config/blob-storage-table";
import { ConfigLoader } from "../../src/config/config-loader";

/**
 * Editing one table of a file this did not write (D45).
 *
 * The same two properties `PluginBlockWriter` is held to, and for the same
 * reasons. The table has to be *correct*, so every assertion here goes through
 * `ConfigLoader` — the loader `serve` uses — rather than against the text. And
 * everything outside the table has to be *untouched*, because `silo init`
 * writes a config that is mostly comments on purpose.
 */
describe("BlobStorageTable", () => {
  let dir: string;
  let configPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-blob-table-"));
    configPath = path.join(dir, "silo.toml");
    // The loader reads env on top of the file; a SILO_* var in the ambient
    // environment would otherwise look like the file said it.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SILO_")) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
    await InitCommand.run(configPath, false);
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("an s3 configuration reads back through the loader", async () => {
    await BlobStorageTable.write(configPath, {
      driver: "s3",
      bucket: "com-quicko-media",
      region: "ap-south-1",
      endpoint: "https://s3.ap-south-1.amazonaws.com",
      accessKeyId: "AKIA…",
      secretAccessKey: "shhh",
      forcePathStyle: true,
    });

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.blob_storage).toEqual({
      driver: "s3",
      bucket: "com-quicko-media",
      region: "ap-south-1",
      endpoint: "https://s3.ap-south-1.amazonaws.com",
      accessKeyId: "AKIA…",
      secretAccessKey: "shhh",
      forcePathStyle: true,
    });
  });

  test("`read` answers with the file's own values, and null with no table", async () => {
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "b", region: "r" });

    expect(await BlobStorageTable.read(configPath)).toMatchObject({
      driver: "s3",
      bucket: "b",
      region: "r",
    });
    expect(await BlobStorageTable.read(path.join(dir, "absent.toml"))).toBeNull();
  });

  test("everything outside the table survives", async () => {
    const before = await fs.readFile(configPath, "utf8");
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "b" });
    const after = await fs.readFile(configPath, "utf8");

    // Every other section, and silo's commentary on it, is still there.
    for (const marker of [
      "# silo.toml — every key is optional",
      "[storage]",
      "[auth]",
      "[search]",
      "[log]",
      "# Changing the tokenizer rebuilds the index on the next start.",
      "# [[plugins]]",
    ]) {
      expect(before).toContain(marker);
      expect(after).toContain(marker);
    }

    // ...and every other setting still loads as it did.
    const config = await ConfigLoader.loadConfig(configPath, true);
    const fresh = ConfigLoader.defaultConfig();
    expect(config.storage).toEqual(fresh.storage);
    expect(config.search).toEqual(fresh.search);
    expect(config.log).toEqual(fresh.log);
  });

  test("an unset value is left out rather than written as empty", async () => {
    // The fs path is the one that matters: unset means "follow the data dir",
    // so a literal here would pin media in place and quietly break --data.
    await BlobStorageTable.write(configPath, { driver: "fs", path: undefined });

    const text = await fs.readFile(configPath, "utf8");
    expect(text).not.toContain("path =");
    expect((await BlobStorageTable.read(configPath))?.path).toBeUndefined();

    const resolved = ConfigLoader.resolveDerivedDefaults(
      await ConfigLoader.loadConfig(configPath, true)
    );
    expect(resolved.blob_storage.path).toBe(path.join("./silo_data", "media"));
  });

  test("a file with no [blob_storage] gets one appended", async () => {
    await fs.writeFile(configPath, 'listen = ":9000"\n\n[storage]\ndriver = "fs"\n', "utf8");
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "later" });

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.listen).toBe(":9000");
    expect(config.storage.driver).toBe("fs");
    expect(config.blob_storage.bucket).toBe("later");
  });

  test("a missing file is created rather than refused", async () => {
    const fresh = path.join(dir, "nested", "silo.toml");

    expect(await BlobStorageTable.write(fresh, { driver: "s3", bucket: "b" })).toBe(true);
    expect((await ConfigLoader.loadConfig(fresh, true)).blob_storage.bucket).toBe("b");
    // Only the first write creates it.
    expect(await BlobStorageTable.write(fresh, { driver: "fs" })).toBe(false);
  });

  test("writing twice replaces the table rather than adding a second one", async () => {
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "first", region: "r" });
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "second" });

    const text = await fs.readFile(configPath, "utf8");
    expect(text.split("[blob_storage]").length - 1).toBe(1);
    expect(text.split(`# ${BlobStorageTable.ManagedNote}`).length - 1).toBe(1);

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.blob_storage.bucket).toBe("second");
    // The region went with the table it was in: this is a whole document, not
    // a patch, which is what keeps the file and the form saying the same thing.
    expect(config.blob_storage.region).toBeUndefined();
  });

  test("the plugins array below the table is not disturbed", async () => {
    await fs.appendFile(
      configPath,
      '\n[[plugins]]\nname = "silo-plugin-slug"\nclaims = []\n',
      "utf8"
    );
    await BlobStorageTable.write(configPath, { driver: "s3", bucket: "b" });

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins.map((each) => each.name)).toEqual(["silo-plugin-slug"]);
  });
});
