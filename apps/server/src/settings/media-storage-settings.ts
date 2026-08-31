import { ValidationError } from "@silo/shared/validation-error";
import type { BlobStorageConfig } from "../config/blob-storage-config";
import { ConfigLoader } from "../config/config-loader";
import type { MediaStorageFacts } from "./media-storage-facts";
import type { MediaStorageInput } from "./media-storage-input";
import type { SettingsOverride } from "./settings-override";

/**
 * The half of media storage settings that touches nothing (D45): reading a
 * request body, merging it onto the file, and working out which fields the file
 * does not decide.
 *
 * Separated from `MediaStorageSupervisor` for the reason `PluginGrantPlan` is
 * separated from the grant screen — the rules worth getting right are the ones
 * about *which value wins*, and they are testable here without a filesystem, a
 * bucket or a running server.
 */
export class MediaStorageSettings {
  /**
   * Each field of the config, where it lives on a `BlobStorageConfig`, and the
   * `SILO_*` variable that outranks the file for it.
   *
   * One table rather than three parallel lists, because the failure mode is a
   * field appearing in the form and in the writer while nothing reports the env
   * var that has been quietly winning over both. `ConfigLoader` is the other
   * side of this table, and the settings test pins them together.
   */
  static readonly Fields: readonly {
    field: keyof MediaStorageInput;
    key: keyof BlobStorageConfig;
    env: string;
  }[] = [
    { field: "driver", key: "driver", env: "SILO_BLOB_DRIVER" },
    { field: "path", key: "path", env: "SILO_BLOB_PATH" },
    { field: "bucket", key: "bucket", env: "SILO_BLOB_S3_BUCKET" },
    { field: "region", key: "region", env: "SILO_BLOB_S3_REGION" },
    { field: "endpoint", key: "endpoint", env: "SILO_BLOB_S3_ENDPOINT" },
    { field: "access_key_id", key: "accessKeyId", env: "SILO_BLOB_S3_ACCESS_KEY_ID" },
    { field: "secret_access_key", key: "secretAccessKey", env: "SILO_BLOB_S3_SECRET_ACCESS_KEY" },
    { field: "force_path_style", key: "forcePathStyle", env: "SILO_BLOB_S3_FORCE_PATH_STYLE" },
  ];

  /**
   * A request body, checked.
   *
   * Only shape is checked here. Whether the driver exists and whether it opens
   * with these settings are the registry's questions, and asking them twice is
   * how the two answers start to disagree — `ProviderRegistry.openBlob` is the
   * one that refuses an s3 driver with no bucket, and it stays the one.
   */
  static parse(body: unknown): MediaStorageInput {
    if (!body || typeof body !== "object") {
      throw new ValidationError(`invalid body: want a media storage configuration object`);
    }
    const raw = body as Record<string, unknown>;

    if (typeof raw.driver !== "string" || raw.driver.trim() === "") {
      throw new ValidationError(`"driver" is required`);
    }

    // Trimmed, because a pasted access key with a trailing newline signs
    // nothing, and it fails as a 403 from the bucket rather than as a typo here.
    // `""` survives the trim and is kept: it is how a field is cleared.
    const text = (value: unknown, field: string): string | undefined => {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== "string") throw new ValidationError(`"${field}" must be a string`);
      return value.trim();
    };

    if (raw.force_path_style !== undefined && raw.force_path_style !== null) {
      if (typeof raw.force_path_style !== "boolean") {
        throw new ValidationError(`"force_path_style" must be a boolean`);
      }
    }

    return {
      // Lower-cased for the reason `ProviderRegistry.openBlob` lower-cases what
      // it looks up: "S3" and "s3" are the same driver, and a config file that
      // spelled one while the registry answered the other would refuse a boot
      // over capitalisation.
      driver: raw.driver.trim().toLowerCase(),
      path: text(raw.path, "path"),
      bucket: text(raw.bucket, "bucket"),
      region: text(raw.region, "region"),
      endpoint: text(raw.endpoint, "endpoint"),
      access_key_id: text(raw.access_key_id, "access_key_id"),
      secret_access_key: text(raw.secret_access_key, "secret_access_key"),
      ...(typeof raw.force_path_style === "boolean"
        ? { force_path_style: raw.force_path_style }
        : {}),
    };
  }

  /**
   * What to write, from what the file holds and what the caller sent.
   *
   * The base is **the file**, never the config in force. A secret supplied
   * through `SILO_BLOB_S3_SECRET_ACCESS_KEY` must not be copied into
   * `silo.toml` by an operator who came to change the region: that would take a
   * credential out of the environment it was deliberately put in and leave a
   * copy in a file that is usually in version control.
   *
   * Every field is replaced by what the caller sent, `secret_access_key`
   * excepted — absent keeps the file's, `""` clears it. It is the one field the
   * caller could not have read back, so it is the one field where an omission
   * cannot honestly mean "remove this".
   */
  static merge(file: BlobStorageConfig | null, input: MediaStorageInput): BlobStorageConfig {
    const set = (value?: string) => (value === undefined || value === "" ? undefined : value);

    return {
      driver: input.driver,
      path: set(input.path),
      bucket: set(input.bucket),
      region: set(input.region),
      endpoint: set(input.endpoint),
      accessKeyId: set(input.access_key_id),
      secretAccessKey:
        input.secret_access_key === undefined
          ? set(file?.secretAccessKey)
          : set(input.secret_access_key),
      ...(input.force_path_style !== undefined ? { forcePathStyle: input.force_path_style } : {}),
    };
  }

  /**
   * Which fields the file does not decide, and what decides them instead.
   *
   * An env var is reported whenever it is *set*, because that is the exact
   * question: `SILO_BLOB_S3_BUCKET` holding the same bucket the file names is
   * still the thing in force, and an operator about to edit that field needs to
   * know the edit will do nothing.
   *
   * Anything else that differs came from a flag — `--blob-path` is the only one
   * today, and asking the question this way reports the next one without this
   * file being touched. The **fs path derivation is not an override**: an unset
   * path means "follow the data dir" (§10), so `<data>/media` turning up in
   * force is the file's own instruction being carried out rather than something
   * overruling it.
   */
  static overrides(
    file: BlobStorageConfig | null,
    inForce: BlobStorageConfig,
    env: Record<string, string | undefined> = process.env
  ): SettingsOverride[] {
    // Defaults rather than nothing, so an instance with no `[blob_storage]`
    // table does not report every field it left alone as overridden.
    const base = file ?? ConfigLoader.defaultConfig().blob_storage;
    const found: SettingsOverride[] = [];

    for (const { field, key, env: variable } of MediaStorageSettings.Fields) {
      const supplied = env[variable];
      if (supplied !== undefined && supplied !== "") {
        found.push({ field, env: variable });
        continue;
      }
      if (MediaStorageSettings.isDerivedPath(field, file, inForce)) continue;
      if (inForce[key] !== base[key]) found.push({ field });
    }

    return found;
  }

  /** A config as the API reports it, secret elided (see `MediaStorageFacts`). */
  static facts(config: BlobStorageConfig | null): MediaStorageFacts {
    return {
      driver: config?.driver || "fs",
      path: config?.path,
      bucket: config?.bucket,
      region: config?.region,
      endpoint: config?.endpoint,
      access_key_id: config?.accessKeyId,
      ...(config && config.forcePathStyle !== undefined
        ? { force_path_style: config.forcePathStyle }
        : {}),
      secret_access_key_set: !!config?.secretAccessKey,
    };
  }

  /** The fs media path `resolveDerivedDefaults` filled in because nobody named
   *  one. Following the data dir is what the file asked for. */
  private static isDerivedPath(
    field: keyof MediaStorageInput,
    file: BlobStorageConfig | null,
    inForce: BlobStorageConfig
  ): boolean {
    return (
      field === "path" &&
      !file?.path &&
      (inForce.driver || "fs").toLowerCase() === "fs" &&
      !!inForce.path
    );
  }
}
