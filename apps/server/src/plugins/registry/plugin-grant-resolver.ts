import { Claims } from "@silo/shared/claims";
import type { HookName } from "@silo/shared/hook-name";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginGrant } from "../../core/plugins/plugin-grant";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { PluginManifest } from "../manifest";
import { PluginPermissionUtils } from "../manifest";
import type { PluginRequest } from "./plugin-request";
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
   * The whole request: claims, which of them are required, and why (D36).
   *
   * Two kinds of claim end up here. The **declared** ones come from
   * `silo.permissions`, with the author's own reason attached. The **derived**
   * ones — a `hooks:` claim per declared hook, and `http:route` when the package
   * declares routes — are computed rather than written, because a plugin already
   * declares its hooks and its routes and restating them as claims would be two
   * lists to keep in step. A derived hook claim is the **maximum**,
   * `hooks:*&#47;*&#47;*:<hook>`, and a grant may narrow the scope, since a narrower
   * claim is covered by the wider request.
   *
   * Derived claims are `required`, and not by the author's say-so: a hook nothing
   * delivers and a route that answers 403 both refuse the start already
   * (`assertDeliverable`, `assertServable`), so calling them optional would be
   * calling a refusal optional.
   */
  static request(manifest: PluginManifest): PluginRequest {
    const declared = PluginPermissionUtils.claims(manifest.permissions);
    const reasons = PluginPermissionUtils.reasons(manifest.permissions);

    const derived: string[] = [];
    for (const hook of manifest.contributes.hooks) {
      const claim = Claims.hook("*", "*", "*", hook);
      derived.push(claim);
      reasons[claim] ??=
        `Declared hook "${hook}" — without this claim the hook is never delivered.`;
    }
    if (manifest.contributes.routes.length > 0) {
      derived.push(Claims.HttpRoute);
      reasons[Claims.HttpRoute] ??=
        `Declares ${manifest.contributes.routes.length} route(s) under ` +
        `/api/ext/${manifest.name}/ — without this claim every one of them answers 403.`;
    }

    const required = PluginPermissionUtils.requiredClaims(manifest.permissions);
    return {
      claims: Claims.normalize([...declared, ...derived]),
      required: Claims.normalize([...required, ...derived]),
      reasons,
    };
  }

  /** Every claim a manifest asks for. The short form of `request`, for the callers
   *  that only need the bound. */
  static requested(manifest: PluginManifest): string[] {
    return PluginGrantResolver.request(manifest).claims;
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
    const request = PluginGrantResolver.request(manifest);

    const excess = PluginGrantUtils.ungranted(request.claims, config.claims);
    if (excess.length > 0) {
      throw new Error(
        `plugin "${config.name}": silo.toml grants ${excess.join(", ")}, which its manifest ` +
          `never requested. A grant may not exceed the request — remove them, or install a ` +
          `version of the plugin that asks for them.`
      );
    }

    const claims = PluginGrantResolver.effective(config.claims, grant);
    return {
      claims,
      state: PluginGrantResolver.state(config.claims, grant),
      missing: PluginGrantUtils.missing(request.claims, claims),
      unmet: PluginGrantUtils.missing(request.required, claims),
      undeliverable: manifest.contributes.hooks.filter(
        (hook) => !PluginGrantResolver.deliverable(claims, hook)
      ),
      keyId: grant?.key_id ?? "",
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
   *
   * Public since D40, because the management API was the surface reporting the
   * record's raw state and therefore saying exactly the wrong thing.
   */
  static state(
    configClaims: readonly string[],
    grant: PluginGrant | null
  ): PluginGrant["state"] {
    if (grant && PluginGrantUtils.isActive(grant.state)) return grant.state;
    if (configClaims.length > 0) return "granted";
    return grant?.state ?? "pending";
  }

  /** Everything a plugin actually holds: the two grant paths, unioned and
   *  normalized. The one answer to "what may this plugin do". */
  static effective(configClaims: readonly string[], grant: PluginGrant | null): string[] {
    return Claims.normalize([...configClaims, ...(grant?.granted ?? [])]);
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
