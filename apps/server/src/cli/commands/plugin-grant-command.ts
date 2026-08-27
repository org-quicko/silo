import { Claims } from "@silo/shared/claims";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { Config } from "../../config/config";
import type { SiloService } from "../../core/services/silo-service";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import { PluginGrantResolver, PluginLoader, PluginRegistry } from "../../plugins";

/**
 * `silo plugin grant | revoke` — the offline half of D34's grant model.
 *
 * Offline and against the data directory, which is what makes it more than a
 * convenience: approving a plugin through the API needs a running server, and a
 * server that refused to start until its plugins were approved could never be
 * given one. It is bounded by filesystem access, the same authority
 * `silo keys create` already has here, so `GrantRequest` carries no claims and
 * the delegation check has nothing to compare against — see its doc comment.
 */
export class PluginGrantCommand {
  static async grant(
    config: Config,
    service: SiloService,
    name: string | undefined,
    claims: string[] | undefined
  ): Promise<void> {
    const pluginConfig = PluginGrantCommand.require(config, name);
    const { manifest } = await PluginLoader.resolve(
      PluginRegistry.directory(config),
      pluginConfig
    );
    const request = PluginGrantResolver.request(manifest);

    // Reconciled first, so `grant` works on a data directory `serve` has never
    // opened — otherwise the first approval would need a server start to create
    // the record it is about to change.
    await service.plugins.reconcile(
      pluginConfig.name,
      request.claims,
      manifest.contributes.hooks,
      request.required,
      PluginGrantUtils.routeLines(manifest.contributes.routes)
    );

    // No `--claims` means "everything it says it requires" (D36). It used to mean
    // everything it asked for, which is the same answer for a package that
    // declares nothing optional — and for one that does, granting the optional
    // half by default would make the word mean nothing. Narrowing further is
    // still the deliberate act, and so still the one that takes an argument.
    const granting = claims ?? request.required;
    const grant = await service.plugins.grant(pluginConfig.name, granting, {
      actor: AuditUtils.cli(),
    });

    console.log(`granted ${grant.granted.length} claim(s) to "${grant.name}":`);
    for (const claim of grant.granted) console.log(`  ${claim}`);

    const missing = PluginGrantUtils.missing(request.claims, grant.granted);
    if (missing.length > 0) {
      // "Not granted in full", because a narrowed hook claim lands here too:
      // asking for `*/*/*` and receiving one collection is a deliberate
      // narrowing, and calling that an oversight would train an operator to
      // grant wider to silence it.
      console.log(`\nrequested, and not granted in full:`);
      for (const claim of missing) console.log(`  ${claim}`);
      console.log(`(a narrower grant than the request is fine — that is what narrowing is.)`);
    }

    const undeliverable = manifest.contributes.hooks.filter(
      (hook) => !PluginGrantResolver.deliverable(grant.granted, hook)
    );
    if (undeliverable.length > 0) {
      // A warning and not a refusal: the operator may be granting in stages,
      // and the start is where this becomes fatal. Saying it here is what stops
      // them discovering it from a plugin that quietly does nothing.
      console.log(
        `\nwarning: ${undeliverable.join(", ")} will never fire — nothing granted delivers ` +
          `${undeliverable.length === 1 ? "it" : "them"}.`
      );
    }
    PluginGrantCommand.reportReach();
  }

  static async revoke(
    config: Config,
    service: SiloService,
    name: string | undefined
  ): Promise<void> {
    const pluginConfig = PluginGrantCommand.require(config, name);
    const grant = await service.plugins.revoke(pluginConfig.name, { actor: AuditUtils.cli() });

    console.log(`revoked the stored grant for "${grant.name}".`);

    // The union rule made visible. Withdrawing the stored half cannot withdraw
    // what `silo.toml` declares, and an operator who thought it had is exactly
    // the person this line exists for.
    if (pluginConfig.claims.length > 0) {
      console.log(
        `\nnote: silo.toml still grants ${pluginConfig.claims.length} claim(s) to this plugin, ` +
          `and those are unaffected:`
      );
      for (const claim of Claims.normalize(pluginConfig.claims)) console.log(`  ${claim}`);
      console.log(`\nEdit its [[plugins]] block to withdraw them.`);
    }
    PluginGrantCommand.reportReach();
  }

  /**
   * Where this change has landed, and where it has not (D39).
   *
   * Through the API a grant takes effect on the next hook and the next
   * `ctx.fetch`. This command is the *offline* path, against the data directory,
   * so a server already running over it is holding a resolved grant in memory
   * that nothing here can reach — and saying "restart" without saying that a
   * rescan also does it would send an operator to the heaviest available remedy.
   */
  private static reportReach(): void {
    console.log(`\nA server already running over this data directory picks this up on`);
    console.log(`POST /api/plugins/rescan, or at its next start. Through the API`);
    console.log(`(PUT /api/plugins/{name}/grant) a change is live immediately.`);
  }

  private static require(config: Config, name: string | undefined) {
    if (!name) {
      console.error(`usage: silo plugin grant <name> [--claims a,b] | revoke <name>`);
      process.exit(1);
    }
    const pluginConfig = config.plugins.find((plugin) => plugin.name === name);
    if (!pluginConfig) {
      console.error(
        `silo: no [[plugins]] entry named "${name}". Listing a plugin in silo.toml is what ` +
          `makes it loadable; granting is a separate decision about one that already is.`
      );
      process.exit(1);
    }
    return pluginConfig;
  }
}
