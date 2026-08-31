import { ValidationError } from "@silo/shared/validation-error";
import type { ConfigSection } from "../config/config-section";
import type { SettingsOverride } from "./settings-override";

/**
 * The half of the settings API that touches nothing (D47): reading a body
 * against a section's spec, merging it onto the file, and naming the fields the
 * file does not decide.
 *
 * `MediaStorageSettings` and `MediaPolicySettings` generalised. Those two spell
 * their fields out because each has a rule of its own — a write-only secret, a
 * base URL that must be absolute. Everything here is a plain typed value, so
 * the spec is enough and hand-writing four more of them would only create four
 * more places for the form and the writer to disagree.
 */
export class ConfigSectionSettings {
  /**
   * A request body, checked against the spec.
   *
   * Unknown keys are **refused** rather than dropped. A caller sending
   * `max_size` for `max_size_mb` has made a mistake, and silently writing a
   * table without it would look exactly like a successful save of a value that
   * never took.
   */
  static parse(section: ConfigSection, body: unknown): Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError(`invalid body: want a [${section.table}] settings object`);
    }
    const raw = body as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(raw)) {
      if (!section.fields.some((field) => field.key === key)) {
        throw new ValidationError(`[${section.table}] has no setting "${key}"`);
      }
    }

    for (const field of section.fields) {
      const value = raw[field.key];
      if (value === undefined || value === null) continue;

      if (field.readOnly) {
        throw new ValidationError(`"${field.key}" is reported here, not changed here`);
      }

      if (field.type === "boolean") {
        if (typeof value !== "boolean") {
          throw new ValidationError(`"${field.key}" must be true or false`);
        }
        out[field.key] = value;
      } else if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new ValidationError(`"${field.key}" must be a number`);
        }
        if (field.min !== undefined && value < field.min) {
          throw new ValidationError(`"${field.key}" must be at least ${field.min}`);
        }
        out[field.key] = value;
      } else if (field.type === "enum") {
        if (typeof value !== "string" || !field.values?.includes(value)) {
          throw new ValidationError(
            `"${field.key}" must be one of: ${(field.values ?? []).join(", ")}`
          );
        }
        out[field.key] = value;
      } else {
        if (typeof value !== "string") {
          throw new ValidationError(`"${field.key}" must be a string`);
        }
        out[field.key] = value.trim();
      }
    }

    return out;
  }

  /**
   * Refuse a save that would loosen a `tightenOnly` section.
   *
   * `[auth]` is the only one, and the rule is narrow on purpose: `disabled` may
   * go to `false` and never to `true`. An API able to switch off the
   * authentication protecting it is a lock whose key opens itself, while the
   * other direction is always safe — an instance running with auth off is one
   * where every caller is already root, so turning it back on is a repair
   * nobody needs permission for that they do not already have.
   */
  static assertTightening(section: ConfigSection, input: Record<string, unknown>): void {
    if (!section.tightenOnly) return;

    for (const field of section.fields) {
      if (field.type === "boolean" && input[field.key] === true) {
        throw new ValidationError(
          `"${field.key}" cannot be turned on through the API. ` +
            `Set it in ${section.table === "auth" ? "silo.toml or SILO_AUTH_DISABLED" : "the config file"} ` +
            `and restart.`
        );
      }
    }
  }

  /**
   * The table to write: the file's own values with the body over them.
   *
   * The base is the **file**, never the configuration in force, so a value
   * being supplied by an environment variable is not copied into the file by an
   * operator who came to change the field next to it.
   */
  static merge(
    file: Record<string, unknown> | null,
    input: Record<string, unknown>
  ): Record<string, unknown> {
    return { ...(file ?? {}), ...input };
  }

  /**
   * Every field the file does not decide, with the variable deciding it where
   * that can be known exactly.
   *
   * An environment variable is named whenever it is **set**, even where it
   * agrees with the file, because the next edit to that field will still do
   * nothing. Otherwise the two configurations are compared, which catches a
   * flag or a file edited by hand since the process started; neither can be
   * named, and both mean the same thing for a reader.
   */
  static overrides(
    section: ConfigSection,
    file: Record<string, unknown> | null,
    inForce: Record<string, unknown>
  ): SettingsOverride[] {
    const found: SettingsOverride[] = [];

    for (const field of section.fields) {
      if (field.env && process.env[field.env]) {
        found.push({ field: field.key, env: field.env });
        continue;
      }
      const named = file?.[field.key];
      if (named === undefined) continue;
      if (JSON.stringify(named) !== JSON.stringify(inForce[field.key])) {
        found.push({ field: field.key });
      }
    }
    return found;
  }

  /**
   * The subset of `next` a restart is still owed for: fields marked `restart`
   * whose new value differs from what this process started on.
   *
   * Compared against **what is running**, not against the file, because that is
   * the only comparison that answers the question the page is asking. A field
   * saved twice back to its original value owes nothing.
   */
  static restartPending(
    section: ConfigSection,
    next: Record<string, unknown>,
    running: Record<string, unknown>
  ): string[] {
    return section.fields
      .filter((field) => field.restart)
      .filter((field) => next[field.key] !== undefined)
      .filter((field) => JSON.stringify(next[field.key]) !== JSON.stringify(running[field.key]))
      .map((field) => field.key);
  }
}
