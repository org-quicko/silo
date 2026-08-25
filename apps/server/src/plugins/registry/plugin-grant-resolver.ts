import { Claims } from "@silo/shared/claims";
import type { HookName } from "@silo/shared/hook-name";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginGrant } from "../../core/plugins/plugin-grant";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { PluginManifest } from "../manifest";
import type { ResolvedGrant } from "./resolved-grant";

/**
 * What a plugin may do, from the two places an operator can say so (D34).
 *
 * Effective authority is `silo.toml` **union** the `_plugins` record, and both
 * halves are bounded by what the manifest requested. Two paths because they
 * serve genuinely different deployments: a container built from a config map
 * cannot use an interactive grant, and an operator running `silo` on a box does
 * not want to hand-edit TOML to withdraw one.
 */
export class PluginGrantResolver {
  /**
   * Everything a manifest is asking for, including the hook claims its declared
   * hooks imply.
   *
   * Derived rather than hand-written, because a plugin already declares its
   * hooks and restating them as claims would be two lists to keep in step. The
   * derived form is the **maximum** — `hooks:*&#47;*&#47;*:<hook>` — and a grant may
   * narrow the scope, since a narrower claim is covered by the wider request.
   */
  static requested(manifest: PluginManifest): string[] {
    const hooks = manifest.hooks.map((hook) => Claims.hook("*", "*", "*", hook));
    return Claims.normalize([...manifest.claims, ...hooks]);
  }

  /**
   * Combine the two grant paths, refusing anything past what was requested.
   *
   * A config that names a claim the manifest never asked for is refused rather
   * than trimmed: it is the same over-grant `assertGranted` used to permit, and
   * an operator who typed it meant something by it, so silently dropping it
   * would be worse than saying no.
   */
  static resolve(
    config: PluginConfig,
    manifest: PluginManifest,
    grant: PluginGrant | null
  ): ResolvedGrant {
    const requested = PluginGrantResolver.requested(manifest);

    const excess = PluginGrantUtils.ungranted(requested, config.claims);
    if (excess.length > 0) {
      throw new Error(
        `plugin "${config.name}": silo.toml grants ${excess.join(", ")}, which its manifest ` +
          `never requested. A grant may not exceed the request — remove them, or install a ` +
          `version of the plugin that asks for them.`
      );
    }

    const claims = Claims.normalize([...config.claims, ...(grant?.granted ?? [])]);
    return {
      claims,
      state: PluginGrantResolver.state(config, grant),
      missing: PluginGrantUtils.missing(requested, claims),
      undeliverable: manifest.hooks.filter((hook) => !PluginGrantResolver.deliverable(claims, hook)),
    };
  }

  /**
   * Where a plugin stands, given both grant paths.
   *
   * The `_plugins` record only ever describes the *store* half, so a plugin
   * granted entirely through `silo.toml` sits at `pending` there forever — and
   * reporting that would tell an operator to approve something that is already
   * running. `needs_review` wins over everything, because it is the one state
   * that is about the package rather than about the grant.
   */
  private static state(config: PluginConfig, grant: PluginGrant | null): PluginGrant["state"] {
    if (grant && PluginGrantUtils.isActive(grant.state)) return grant.state;
    if (config.claims.length > 0) return "granted";
    return grant?.state ?? "pending";
  }

  /**
   * Whether any held claim permits this hook in **some** scope.
   *
   * "Some" and not "this collection": a grant confined to one project is a
   * legitimate narrowing, and only a plugin that can be delivered a declared
   * hook nowhere at all is misconfigured rather than scoped. The per-event
   * question is `Claims.canDeliver`, asked by `HookBus` with a real target.
   */
  static deliverable(claims: readonly string[], hook: HookName): boolean {
    return claims.some((held) => {
      try {
        const parsed = Claims.parse(held);
        return parsed.kind === "root" || (parsed.kind === "hook" && parsed.hook === hook);
      } catch {
        return false;
      }
    });
  }
}
