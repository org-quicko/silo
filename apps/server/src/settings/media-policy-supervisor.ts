import fs from "fs/promises";
import { ValidationError } from "@silo/shared/validation-error";
import type { Config } from "../config/config";
import { MediaDefaults } from "../config/media-defaults";
import { MediaTable } from "../config/media-table";
import type { AuditActor } from "../core/audit/audit-actor";
import { AsyncMutex } from "../core/services/support/async-mutex";
import type { SiloService } from "../core/services/silo-service";
import type { Logger } from "../logging/logger";
import { ConfigFileAccess } from "./config-file-access";
import type { MediaPolicyInput } from "./media-policy-input";
import { MediaPolicySettings } from "./media-policy-settings";
import type { MediaPolicyView } from "./media-policy-view";

export interface MediaPolicySupervisorOptions {
  service: SiloService;
  /** The config this process is running on. Replaced by a successful save. */
  config: Config;
  logger: Logger;
  /** Re-read `silo.toml` the way this process was started, flags and
   *  environment included. Absent in a process handed no file, where a save
   *  refuses rather than writing somewhere it invented. */
  reload?: () => Promise<Config>;
  configPath?: string;
}

/**
 * Reading and changing the `[media]` table live (D46): where media URLs point,
 * and what the library accepts.
 *
 * `MediaStorageSupervisor`'s sibling, and its rule is the same one —
 *
 * > **The file must never describe a state the next `serve` cannot reach.**
 *
 * — so the order is the same: write the file, re-read it **the way a start
 * reads it** with flags and environment back on top, and apply *that* rather
 * than the posted body. A `SILO_MEDIA_BASE_URL` outranks the file at the next
 * start, so an instance running on the posted value in between would be
 * resolving URLs nothing else agrees with.
 *
 * Applying is one assignment, for `useBlobStorage`'s reason: every upload reads
 * the allowlist and every response builds its links at the moment it acts, so
 * there is nothing to rebuild. What it cannot do is reach backwards. Changing
 * the base URL does not rewrite a URL already sitting in a sent email, and
 * narrowing the allowlist does not remove files already in the library. The
 * page says both.
 */
export class MediaPolicySupervisor {
  private readonly service: SiloService;
  private readonly logger: Logger;
  private readonly reload?: () => Promise<Config>;
  private readonly configPath?: string;
  private readonly lock = new AsyncMutex();

  private config: Config;

  constructor(options: MediaPolicySupervisorOptions) {
    this.service = options.service;
    this.logger = options.logger;
    this.config = options.config;
    this.reload = options.reload;
    this.configPath = options.configPath;
  }

  /** What the file says, what the process is doing, and where the two differ. */
  async view(): Promise<MediaPolicyView> {
    const file = this.configPath ? await MediaTable.read(this.configPath) : null;
    const inForce = this.service.mediaConfig;

    return {
      file: file ?? {},
      in_force: inForce,
      overrides: MediaPolicySettings.overrides(file, inForce),
      default_extensions: [...MediaDefaults.Extensions],
      ...(this.configPath ? { config_path: this.configPath } : {}),
      ...(await ConfigFileAccess.report(this.configPath, !!this.reload)),
    };
  }

  /** Write the table, apply it, and answer with the view a fresh `GET` would. */
  async save(input: MediaPolicyInput, actor: AuditActor): Promise<MediaPolicyView> {
    const release = await this.lock.acquire();
    try {
      await this.apply(input, actor);
      return await this.view();
    } finally {
      release();
    }
  }

  private async apply(input: MediaPolicyInput, actor: AuditActor): Promise<void> {
    const configPath = this.configPath;
    if (!configPath || !this.reload) {
      throw new ValidationError(
        `this process was not started from a config file, so there is nothing to write. ` +
          `Configure [media] where this instance is started from, or set the ` +
          `SILO_MEDIA_* environment variables.`
      );
    }

    const file = await MediaTable.read(configPath);
    const next = MediaPolicySettings.merge(file, input);

    const restore = await MediaPolicySupervisor.snapshot(configPath);
    const created = await ConfigFileAccess.writing(configPath, restore, () =>
      MediaTable.write(configPath, next)
    );

    let config: Config;
    try {
      config = await this.reload();
    } catch (caught) {
      await restore();
      throw new ValidationError(
        `${MediaPolicySupervisor.message(caught)} — ${configPath} was left as it was.`
      );
    }

    this.service.useMediaConfig(config.media);
    this.config = config;

    this.logger.info("media settings changed", {
      base_url: config.media.base_url || "(request origin)",
      target: config.media.base_url_target,
      extensions: config.media.extensions.length,
      ...(created ? { created: configPath } : {}),
    });

    await this.service.audit.record("media.configure", actor, "media", {
      ...config.media,
      config_path: configPath,
    });
  }

  /**
   * A closure that puts the file back exactly as it was, including not being
   * there at all. Taken before the write rather than reconstructed after it,
   * because "what it was" includes the comments and the layout `MediaTable`
   * preserved.
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
