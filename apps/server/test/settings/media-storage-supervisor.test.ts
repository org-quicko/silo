import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ValidationError } from "@silo/shared/validation-error";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { InitCommand } from "../../src/cli/commands/init-command";
import { BlobStorageTable } from "../../src/config/blob-storage-table";
import { ConfigLoader } from "../../src/config/config-loader";
import type { Config } from "../../src/config/config";
import { SiloService } from "../../src/core/services/silo-service";
import { Logger } from "../../src/logging/logger";
import { ProviderRegistry } from "../../src/plugins";
import { MediaStorageSettings, MediaStorageSupervisor } from "../../src/settings";

/**
 * Changing where media lives, on a running instance (D45).
 *
 * Two properties carry this file. A save must **take effect without a restart**
 * — the swap is one assignment, and the test for it is that the next upload
 * lands somewhere else. And a save that cannot be applied must leave
 * `silo.toml` exactly as it found it, because the file is what the next `serve`
 * reads: a refused API call that leaves an unbootable config behind is the
 * failure `PluginSupervisor` states its whole ordering rule against.
 */
describe("MediaStorageSupervisor", () => {
  let dir: string;
  let configPath: string;
  let store: SqliteStore;
  let service: SiloService;
  let providers: ProviderRegistry;
  let supervisor: MediaStorageSupervisor;
  let config: Config;
  const savedEnv: Record<string, string | undefined> = {};

  const reload = async (): Promise<Config> =>
    ConfigLoader.resolveDerivedDefaults(await ConfigLoader.loadConfig(configPath, true));

  const bytes = (text: string) => new TextEncoder().encode(text);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-storage-"));
    configPath = path.join(dir, "silo.toml");
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SILO_")) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }

    await InitCommand.run(configPath, false);
    // The data dir the fs blob path derives from, so nothing lands in the cwd.
    await BlobStorageTable.write(configPath, { driver: "fs" });
    const text = await fs.readFile(configPath, "utf8");
    await fs.writeFile(
      configPath,
      text.replace('path   = "./silo_data"', `path   = ${JSON.stringify(dir)}`),
      "utf8"
    );

    config = await reload();
    providers = ProviderRegistry.withBuiltins();
    store = await SqliteStore.open(path.join(dir, "silo.db"));
    service = new SiloService(store, { blobStorage: providers.openBlob(config.blob_storage) });
    supervisor = new MediaStorageSupervisor({
      service,
      providers,
      config,
      logger: Logger.silent(),
      reload,
      configPath,
    });
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await store.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("the view separates what the file holds from what is in force", async () => {
    const view = await supervisor.view();

    expect(view.file.driver).toBe("fs");
    // Unset in the file, derived from the data dir in force — the distinction
    // the two halves of the view exist for.
    expect(view.file.path).toBeUndefined();
    expect(view.in_force.path).toBe(path.join(dir, "media"));
    expect(view.overrides).toEqual([]);
    expect(view.drivers).toEqual(["fs", "s3"]);
    expect(view.config_path).toBe(configPath);
    expect(view.writable).toBe(true);
  });

  test("a save takes effect on the next upload, without a restart", async () => {
    const before = await service.media.save("before.txt", bytes("before"), "text/plain");
    expect(await fs.readFile(path.join(dir, "media", before.blob_key!), "utf8")).toBe("before");

    const moved = path.join(dir, "moved");
    const view = await supervisor.save(
      MediaStorageSettings.parse({ driver: "fs", path: moved }),
      { kind: "cli" }
    );
    expect(view.file.path).toBe(moved);
    expect(view.in_force.path).toBe(moved);

    const after = await service.media.save("after.txt", bytes("after"), "text/plain");
    expect(await fs.readFile(path.join(moved, after.blob_key!), "utf8")).toBe("after");

    // ...and the bytes did not follow. The catalog still lists the first asset,
    // and the new store has never heard of it — which is what the admin warns
    // about before it saves, rather than something a swap could paper over.
    expect(await service.media.bytes(before.id)).toBeNull();
    expect((await service.media.list()).total).toBe(2);

    // The next start reads the same thing this process applied.
    expect((await reload()).blob_storage.path).toBe(moved);
  });

  test("an unopenable configuration is refused and the file is left alone", async () => {
    const before = await fs.readFile(configPath, "utf8");

    // s3 with no bucket: `ProviderRegistry.openBlob` is the one that refuses it,
    // and it does so only once the file has been written, so this is the case
    // the rollback exists for.
    await expect(
      supervisor.save(MediaStorageSettings.parse({ driver: "s3" }), { kind: "cli" })
    ).rejects.toThrow(ValidationError);

    expect(await fs.readFile(configPath, "utf8")).toBe(before);
    expect((await supervisor.view()).in_force.driver).toBe("fs");

    // The running store is untouched: an upload still works.
    const asset = await service.media.save("still.txt", bytes("still"), "text/plain");
    expect((await service.media.bytes(asset.id))!.data).toEqual(bytes("still"));
  });

  test("an unknown driver is refused before anything is written", async () => {
    const before = await fs.readFile(configPath, "utf8");

    await expect(
      supervisor.save(MediaStorageSettings.parse({ driver: "gdrive" }), { kind: "cli" })
    ).rejects.toThrow(/unknown blob storage driver/);

    expect(await fs.readFile(configPath, "utf8")).toBe(before);
  });

  test("the secret is kept across a save and never reported", async () => {
    await BlobStorageTable.write(configPath, {
      driver: "fs",
      secretAccessKey: "shhh",
    });

    // A save that says nothing about the secret keeps the file's, so an
    // operator changing the region does not have to re-enter a credential they
    // cannot read back.
    await supervisor.save(
      MediaStorageSettings.parse({ driver: "fs", path: path.join(dir, "with-secret") }),
      { kind: "cli" }
    );
    expect((await BlobStorageTable.read(configPath))?.secretAccessKey).toBe("shhh");

    const view = await supervisor.view();
    expect(view.file.secret_access_key_set).toBe(true);
    expect(JSON.stringify(view)).not.toContain("shhh");

    // ...and an empty one clears it, which is the only way out.
    await supervisor.save(
      MediaStorageSettings.parse({ driver: "fs", secret_access_key: "" }),
      { kind: "cli" }
    );
    expect((await BlobStorageTable.read(configPath))?.secretAccessKey).toBeUndefined();
  });

  test("an environment variable is reported as what is in force", async () => {
    process.env.SILO_BLOB_S3_BUCKET = "from-the-environment";
    try {
      await supervisor.save(
        MediaStorageSettings.parse({ driver: "s3", bucket: "from-the-form" }),
        { kind: "cli" }
      );

      const view = await supervisor.view();
      expect(view.file.bucket).toBe("from-the-form");
      expect(view.in_force.bucket).toBe("from-the-environment");
      expect(view.overrides).toContainEqual({
        field: "bucket",
        env: "SILO_BLOB_S3_BUCKET",
      });
    } finally {
      delete process.env.SILO_BLOB_S3_BUCKET;
    }
  });

  test("a secret in the environment is not copied into the file", async () => {
    process.env.SILO_BLOB_S3_SECRET_ACCESS_KEY = "from-the-environment";
    try {
      await supervisor.save(
        MediaStorageSettings.parse({ driver: "s3", bucket: "b", region: "ap-south-1" }),
        { kind: "cli" }
      );
      expect((await BlobStorageTable.read(configPath))?.secretAccessKey).toBeUndefined();
      expect(await fs.readFile(configPath, "utf8")).not.toContain("from-the-environment");
    } finally {
      delete process.env.SILO_BLOB_S3_SECRET_ACCESS_KEY;
    }
  });

  test("a process with no config file can report but not save", async () => {
    const readOnly = new MediaStorageSupervisor({
      service,
      providers,
      config,
      logger: Logger.silent(),
    });

    const view = await readOnly.view();
    expect(view.writable).toBe(false);
    expect(view.config_path).toBeUndefined();
    expect(view.in_force.driver).toBe("fs");

    await expect(
      readOnly.save(MediaStorageSettings.parse({ driver: "fs" }), { kind: "cli" })
    ).rejects.toThrow(/not started from a config file/);
  });

  test("a config file the server cannot write is refused, not answered with a fault", async () => {
    // A directory where the file should be: the one way to make a path
    // unwritable that behaves the same on Linux and on Windows. What a
    // container hits is EACCES on an image directory, and it arrives here by
    // the same route (D50).
    const blocked = path.join(dir, "blocked.toml");
    await fs.mkdir(blocked);

    const stuck = new MediaStorageSupervisor({
      service,
      providers,
      config,
      logger: Logger.silent(),
      reload: async () => config,
      configPath: blocked,
    });

    const raised = await stuck
      .save(MediaStorageSettings.parse({ driver: "fs" }), { kind: "cli" })
      .catch((caught) => caught);

    // A `ValidationError` is a 400 with the reason in it. A plain one is the
    // `500 internal error` that sent an operator to the server log.
    expect(ValidationError.is(raised)).toBe(true);
    expect(raised.message).toContain(blocked);
    expect(raised.message).toMatch(/SILO_CONFIG/);
  });

  test("the change is in the audit trail, and the secret is not", async () => {
    await supervisor.save(
      MediaStorageSettings.parse({
        driver: "s3",
        bucket: "com-quicko-media",
        secret_access_key: "shhh",
      }),
      { kind: "cli" }
    );

    const trail = await service.audit.list({ subject: "blob_storage" });
    expect(trail.items).toHaveLength(1);
    expect(trail.items[0]!.action).toBe("media.configure");
    expect(trail.items[0]!.detail).toMatchObject({
      driver: "s3",
      bucket: "com-quicko-media",
      secret_access_key_set: true,
    });
    expect(JSON.stringify(trail.items[0])).not.toContain("shhh");
  });
});
