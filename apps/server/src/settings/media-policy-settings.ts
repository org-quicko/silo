import { ValidationError } from "@silo/shared/validation-error";
import type { MediaConfig } from "../config/media-config";
import { MediaTable } from "../config/media-table";
import type { MediaPolicyInput } from "./media-policy-input";
import type { SettingsOverride } from "./settings-override";

/**
 * The half of the `[media]` settings that touches nothing (D46): reading a
 * body, merging it onto the file, and naming the fields the file does not
 * decide.
 *
 * `MediaStorageSettings`' sibling, and split off its supervisor for the same
 * reason — which value wins is the part worth getting right, and it is
 * testable here with no filesystem and no running server.
 */
export class MediaPolicySettings {
  /** Each field, and the `SILO_*` variable that outranks the file for it.
   *  `ConfigLoader` is the other side of this table; a test pins them together. */
  static readonly Fields: readonly { field: keyof MediaPolicyInput; env: string }[] = [
    { field: "base_url", env: "SILO_MEDIA_BASE_URL" },
    { field: "base_url_target", env: "SILO_MEDIA_BASE_URL_TARGET" },
    { field: "extensions", env: "SILO_MEDIA_EXTENSIONS" },
  ];

  /**
   * A request body, checked for shape.
   *
   * The base URL is checked for more than shape, because it is the one field
   * whose mistakes are invisible until a reader somewhere else follows the
   * link: a relative value, or one with a path on it, produces URLs that look
   * plausible in the admin and 404 in an email.
   */
  static parse(body: unknown): MediaPolicyInput {
    if (!body || typeof body !== "object") {
      throw new ValidationError(`invalid body: want a media settings object`);
    }
    const raw = body as Record<string, unknown>;
    const input: MediaPolicyInput = {};

    if (raw.base_url !== undefined && raw.base_url !== null) {
      if (typeof raw.base_url !== "string") {
        throw new ValidationError(`"base_url" must be a string`);
      }
      input.base_url = MediaPolicySettings.baseUrl(raw.base_url);
    }

    if (raw.base_url_target !== undefined && raw.base_url_target !== null) {
      if (raw.base_url_target !== "server" && raw.base_url_target !== "store") {
        throw new ValidationError(`"base_url_target" must be "server" or "store"`);
      }
      input.base_url_target = raw.base_url_target;
    }

    if (raw.extensions !== undefined && raw.extensions !== null) {
      if (!Array.isArray(raw.extensions)) {
        throw new ValidationError(`"extensions" must be an array of strings`);
      }
      input.extensions = MediaTable.extensions(raw.extensions);
      if (input.extensions.length === 0) {
        // An empty allowlist accepts nothing, which is a library that cannot be
        // used rather than one with no policy. `["*"]` is how you say "no
        // policy", and it says it out loud.
        throw new ValidationError(
          `"extensions" cannot be empty. Use ["*"] to accept every file type.`
        );
      }
    }

    return input;
  }

  /**
   * The table to write: the file's own values with the body over them.
   *
   * The base is the **file**, never what is in force, so an operator editing
   * the extension list does not silently copy a base URL out of the environment
   * and into a file that is usually in version control.
   */
  static merge(file: Partial<MediaConfig> | null, input: MediaPolicyInput): MediaConfig {
    return {
      ...(input.base_url !== undefined
        ? input.base_url
          ? { base_url: input.base_url }
          : {}
        : file?.base_url
          ? { base_url: file.base_url }
          : {}),
      base_url_target: input.base_url_target ?? file?.base_url_target ?? "server",
      extensions: input.extensions ?? file?.extensions ?? [],
    };
  }

  /**
   * Every field the file does not decide, with the variable deciding it where
   * that can be known exactly.
   *
   * An environment variable is named whenever it is set, because it wins by
   * definition. Otherwise the two configurations are compared, which catches a
   * flag or a file edited by hand since the process started — neither can be
   * named, and both have the same consequence: the file is not what is in use.
   */
  static overrides(file: Partial<MediaConfig> | null, inForce: MediaConfig): SettingsOverride[] {
    const found: SettingsOverride[] = [];

    for (const { field, env } of MediaPolicySettings.Fields) {
      if (process.env[env]) {
        found.push({ field, env });
        continue;
      }
      if (MediaPolicySettings.differs(field, file, inForce)) found.push({ field });
    }
    return found;
  }

  /**
   * Whether one field of the file disagrees with the running configuration.
   *
   * A file with no `[media]` at all is compared against silo's defaults rather
   * than reported as overriding everything: an instance that never configured
   * media is agreeing with the file, not being beaten by something.
   */
  private static differs(
    field: keyof MediaPolicyInput,
    file: Partial<MediaConfig> | null,
    inForce: MediaConfig
  ): boolean {
    const named = file?.[field];
    if (named === undefined) return false;
    return JSON.stringify(named) !== JSON.stringify(inForce[field]);
  }

  /**
   * A base URL silo will stand behind: absolute, http or https, host only.
   *
   * A path is refused rather than accepted and joined, because the two shapes
   * fail differently and only one of them fails visibly. `/uploads` would
   * resolve against whatever origin the reader happened to have, which is the
   * request's own — exactly what leaving the field empty already does, and it
   * says so.
   */
  private static baseUrl(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ValidationError(
        `"base_url" must be an absolute URL like "https://cdn.example.com". ` +
          `Leave it empty to use the address each request arrived on.`
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError(`"base_url" must be http or https, not "${parsed.protocol}"`);
    }
    return trimmed;
  }
}
