import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { PluginPermission } from "./plugin-permission";
import type { PluginPermissions } from "./plugin-permissions";

/**
 * Validates `silo.permissions` (D36).
 *
 * Claims are validated here rather than only where they are enforced, so a typo
 * is a refused start naming the plugin, not a permission that silently never
 * matches anything at request time.
 *
 * The `reason` is validated just as strictly, which is the part that looks like
 * ceremony and is not. A reason is the only thing on a grant screen that explains
 * *why* a package wants what it wants, an author who may omit it will, and a
 * blank line beside `collections:*&#47;*&#47;*:entries:delete` is worse than no field at
 * all — it tells an operator that nothing needs saying.
 */
export class ManifestPermissionsReader {
  static read(name: string, raw: unknown): PluginPermissions {
    if (raw === undefined) return { required: [], optional: [] };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(
        `plugin "${name}": "silo.permissions" must be an object with "required" and/or ` +
          `"optional" arrays.`
      );
    }

    const block = raw as Record<string, unknown>;
    const permissions: PluginPermissions = {
      required: ManifestPermissionsReader.list(name, "required", block.required),
      optional: ManifestPermissionsReader.list(name, "optional", block.optional),
    };

    // The same claim in both lists has no answer: it is either needed or it is
    // not, and a default grant would have to pick one reading over the other.
    const required = new Set(permissions.required.map((each) => each.claim));
    const both = permissions.optional.filter((each) => required.has(each.claim));
    if (both.length > 0) {
      throw new Error(
        `plugin "${name}": ${both.map((each) => `"${each.claim}"`).join(", ")} ` +
          `${both.length === 1 ? "is" : "are"} declared both required and optional. A claim is ` +
          `one or the other — required is what a default grant approves.`
      );
    }
    return permissions;
  }

  private static list(name: string, which: string, raw: unknown): PluginPermission[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new Error(`plugin "${name}": "silo.permissions.${which}" must be an array.`);
    }

    const permissions: PluginPermission[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(
          `plugin "${name}": every entry in "silo.permissions.${which}" must be an object ` +
            `{ "claim": …, "reason": … }.`
        );
      }
      const claim = ManifestPermissionsReader.claim(name, which, entry.claim);
      const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
      if (reason.length === 0) {
        throw new Error(
          `plugin "${name}": permission "${claim}" needs a "reason". It is what an operator ` +
            `reads while deciding whether to approve it.`
        );
      }
      if (seen.has(claim)) {
        throw new Error(
          `plugin "${name}": permission "${claim}" is declared more than once in ` +
            `"silo.permissions.${which}".`
        );
      }
      seen.add(claim);
      permissions.push({ claim, reason });
    }
    return permissions;
  }

  private static claim(name: string, which: string, raw: unknown): string {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error(
        `plugin "${name}": every entry in "silo.permissions.${which}" needs a "claim" string.`
      );
    }
    try {
      // normalize is the validator: it rejects anything `isValid` does not
      // recognise. Called on one claim so the refusal can name it.
      Claims.normalize([raw]);
    } catch (caught: any) {
      const detail = ValidationError.is(caught) ? caught.message : String(caught?.message ?? caught);
      throw new Error(`plugin "${name}": invalid claim in "silo.permissions.${which}": ${detail}`);
    }
    return raw;
  }
}
