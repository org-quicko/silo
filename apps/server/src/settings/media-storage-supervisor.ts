import fs from "fs/promises";
import { ValidationError } from "@silo/shared/validation-error";
import { BlobStorageTable } from "../config/blob-storage-table";
import type { Config } from "../config/config";
import type { AuditActor } from "../core/audit/audit-actor";
import type { BlobStorage } from "../core/ports/blob-storage";
import { AsyncMutex } from "../core/services/support/async-mutex";
import type { SiloService } from "../core/services/silo-service";
import type { Logger } from "../logging/logger";
import type { ProviderRegistry } from "../plugins";
import type { MediaStorageInput } from "./media-storage-input";
import { MediaStorageSettings } from "./media-storage-settings";
import type { MediaStorageView } from "./media-storage-view";

export interface MediaStorageSupervisorOptions {
  service: SiloService;
  /** Which driver names can be opened, built-ins and plugin providers alike. */
  providers: ProviderRegistry;
  /** The config this process is running on. Replaced by a successful save. */
  config: Config;
  logger: Logger;
  /** Re-read `silo.toml` exactly as this process was started with it, flags and
   *  environment included — `PluginSupervisor`'s closure, and the same one, so
   *  what a save applies is what the next `serve` would compute. Absent in a
   *  process that was never handed a file, where a save refuses. */
  reload?: () => Promise<Config>;
  configPath?: string;
}

/**
 * Reading and changing where the media library keeps its bytes, live (D45).
 *
 * The `[blob_storage]` half of what `PluginSupervisor` does for `[[plugins]]`,
 * and it takes that class's rule unchanged:
 *
 * > **The file must never describe a state the next `serve` cannot reach.**
 *
 * Which settles the order. The driver is checked against the registry *before*
 * anything is written, because a typo is the likely mistake and it should cost
 * nothing. The file is written next. Then the config is re-read **the way a
 * start reads it** — flags and env vars back on top — and the store is opened
 * from *that*, not from what was posted: a bucket supplied by
 * `SILO_BLOB_S3_BUCKET` outranks the file at the next start, so an instance
 * that ran on the posted value in the meantime would be reporting a
 * configuration nothing else agrees with. If either step fails, the file goes
 * back to what it was and the caller is told why.
 *
 * The swap itself is one assignment (`ServiceContext.useBlobStorage`). What it
 * does not do is **move any bytes** — an instance repointed from a directory to
 * a bucket keeps a catalog full of assets the new store has never heard of.
 * That is a property of object stores rather than something a swap could paper
 * over, so the admin says it plainly before it saves and `silo media reconcile`
 * is what reports the damage afterwards.
 */
export class MediaStorageSupervisor {
  private readonly service: SiloService;
  private readonly providers: ProviderRegistry;
  private readonly logger: Logger;
  private readonly reload?: () => Promise<Config>;
  private readonly configPath?: string;
  private readonly lock = new AsyncMutex();

  private config: Config;

  constructor(options: MediaStorageSupervisorOptions) {
    this.service = options.service;
    this.providers = options.providers;
    this.logger = options.logger;
    this.config = options.config;
    this.reload = options.reload;
    this.configPath = options.configPath;
  }

  /**
   * What the file says, what the process is doing, and where the two differ.
   *
   * The file is read from disk on every call and `in_force` is the config this
   * process opened its store from — deliberately not both from the same place,
   * because a file edited by hand since the start is exactly the disagreement
   * this page exists to show.
   */
  async view(): Promise<MediaStorageView> {
    const file = this.configPath ? await BlobStorageTable.read(this.configPath) : null;
    const inForce = this.config.blob_storage;

    return {
      file: MediaStorageSettings.facts(file),
      in_force: MediaStorageSettings.facts(inForce),
      drivers: this.providers.drivers().blob,
      overrides: MediaStorageSettings.overrides(file, inForce),
      ...(this.configPath ? { config_path: this.configPath } : {}),
      writable: this.writable(),
    };
  }

  /** Write the table, apply it, and answer with the view a fresh `GET` would. */
  async save(input: MediaStorageInput, actor: AuditActor): Promise<MediaStorageView> {
    const release = await this.lock.acquire();
    try {
      await this.apply(input, actor);
      return await this.view();
    } finally {
      release();
    }
  }

  private writable(): boolean {
    return !!this.configPath && !!this.reload;
  }

  private async apply(input: MediaStorageInput, actor: AuditActor): Promise<void> {
    const configPath = this.configPath;
    if (!configPath || !this.reload) {
      throw new ValidationError(
        `this process was not started from a config file, so there is nothing to write. ` +
          `Configure [blob_storage] where this instance is started from, or set the ` +
          `SILO_BLOB_* environment variables.`
      );
    }

    const available = this.providers.drivers().blob;
    if (!available.includes(input.driver.toLowerCase())) {
      throw new ValidationError(
        `unknown blob storage driver "${input.driver}". Available: ${available.join(", ")}.`
      );
    }

    // The file's own values are the base, so a secret held in the environment is
    // never copied into the file by someone editing the region next to it.
    const file = await BlobStorageTable.read(configPath);
    const next = MediaStorageSettings.merge(file, input);

    const restore = await MediaStorageSupervisor.snapshot(configPath);
    const created = await BlobStorageTable.write(configPath, next);
    const { config, blob } = await this.openWritten(this.reload, configPath, restore);

    const replaced = this.service.useBlobStorage(blob);
    this.config = config;

    // Forgiven, and last: the store is already off the read path, so a driver
    // that objects to being closed must not turn a completed change into a
    // failed request.
    try {
      await replaced.close?.();
    } catch (caught) {
      this.logger.warn("the previous media store did not close cleanly", {
        message: MediaStorageSupervisor.message(caught),
      });
    }

    this.logger.info("media storage repointed", {
      driver: config.blob_storage.driver,
      ...(created ? { created: configPath } : {}),
    });

    const facts = MediaStorageSettings.facts(config.blob_storage);
    await this.service.audit.record("media.configure", actor, "blob_storage", {
      ...facts,
      config_path: configPath,
    });
  }

  /**
   * Re-read the file the way a start would, and open the store it names.
   *
   * The reload is what makes the flag and env layers apply to what was just
   * written, so the store this process runs on is the store the next `serve`
   * would open. A failure here is the caller's settings being unopenable —
   * `ProviderRegistry` refuses an s3 driver with no bucket — so the file goes
   * back and it becomes a 400 rather than the plain `Error` a refused boot
   * throws, where there is no caller to tell.
   */
  private async openWritten(
    reload: () => Promise<Config>,
    configPath: string,
    restore: () => Promise<void>
  ): Promise<{ config: Config; blob: BlobStorage }> {
    try {
      const config = await reload();
      return { config, blob: this.providers.openBlob(config.blob_storage) };
    } catch (caught) {
      await restore();
      throw new ValidationError(
        `${MediaStorageSupervisor.message(caught)} — ${configPath} was left as it was.`
      );
    }
  }

  /**
   * A closure that puts the file back exactly as it was, including not being
   * there at all.
   *
   * Taken before the write rather than reconstructed after it, because "what it
   * was" includes the comments and the layout that `BlobStorageTable` preserved
   * — re-rendering the previous settings would roll back the values and quietly
   * reformat everything around them.
   */
  private static async snapshot(configPath: string): Promise<() => Promise<void>> {
    let before: string | null;
    try {
      before = await fs.readFile(configPath, "utf8");
    } catch {
      before = null;
    }

    return async () => {
      if (before === null) await fs.rm(configPath, { force: true }).catch(() => {});
      else await fs.writeFile(configPath, before, "utf8").catch(() => {});
    };
  }

  private static message(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
