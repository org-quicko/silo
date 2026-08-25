import type { Config } from "../../config/config";
import type { SiloService } from "../../core/services/silo-service";
import { Logger } from "../../logging/logger";
import {
  PluginContributionUtils,
  PluginGrantResolver,
  PluginLoader,
  PluginRegistry,
  ProviderRegistry,
} from "../../plugins";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import { PluginGrantCommand } from "./plugin-grant-command";
import { SiloVersion } from "../../version";

/**
 * `silo plugin list | info | doctor` (D31/§13.8).
 *
 * All three are **read-only and offline**, and they stay that way now that an
 * installer exists: `silo add` (D32) is the one command that reaches the
 * network and the one that writes, and it is routed in `Cli` rather than here
 * so that "the plugin diagnostics" and "the thing that changes what runs" are
 * not the same object. `silo plugin add` is accepted as a spelling of `silo
 * add` and dispatches there.
 *
 * A plugin remains a directory under `<data dir>/plugins/` named in
 * `silo.toml`; `add` writes exactly that and nothing downstream can tell the
 * two apart, which is what let an installer land without touching §13.
 *
 * `doctor` is the one that loads code, which is exactly what it is for: it
 * answers "would `serve` start?" without starting a server, in the same spirit
 * as `silo search reindex --check`.
 */
export class PluginCommand {
  static async run(
    config: Config,
    service: SiloService,
    positionals: string[],
    values: Record<string, unknown> = {}
  ): Promise<void> {
    const sub = positionals[1] ?? "list";

    switch (sub) {
      case "list":
        return await PluginCommand.list(config, service);
      case "info":
        return await PluginCommand.info(config, service, positionals[2]);
      case "doctor":
        return await PluginCommand.doctor(config, service);
      case "grant":
        return await PluginGrantCommand.grant(
          config,
          service,
          positionals[2],
          PluginCommand.claimsFlag(values)
        );
      case "revoke":
        return await PluginGrantCommand.revoke(config, service, positionals[2]);
      default:
        console.error(
          `usage: silo plugin list | info <name> | grant <name> [--claims a,b] | ` +
            `revoke <name> | doctor | add <spec>`
        );
        process.exit(1);
    }
  }

  /**
   * `--claims a,b,c`, absent meaning "everything the manifest requested".
   *
   * Read from the parsed flags, never from the positionals: `--claims` is in
   * `CliOptions.Flags` (it is `silo add`'s too), so `parseArgs` consumes it and
   * it never appears there. Scanning the positionals found nothing, silently
   * fell back to "grant everything requested", and made both a narrowed grant
   * and a refused over-grant look like they had worked.
   *
   * Presence, not truthiness — `--claims ""` means "grant nothing", which is a
   * coherent thing to ask for and must not read as "grant everything". D32
   * learned the same lesson about `--integrity ""`.
   */
  private static claimsFlag(values: Record<string, unknown>): string[] | undefined {
    const raw = values.claims;
    if (raw === undefined) return undefined;
    if (typeof raw !== "string") {
      console.error(`silo: --claims needs a comma-separated list`);
      process.exit(1);
    }
    return raw
      .split(",")
      .map((claim) => claim.trim())
      .filter(Boolean);
  }

  private static async list(config: Config, service: SiloService): Promise<void> {
    const drivers = ProviderRegistry.withBuiltins().drivers();
    console.log(`storage drivers: ${drivers.storage.join(", ")}`);
    console.log(`blob drivers   : ${drivers.blob.join(", ")}`);
    console.log(`plugins dir    : ${PluginRegistry.directory(config)}\n`);

    if (config.plugins.length === 0) {
      console.log(`no plugins configured. Add a [[plugins]] entry to silo.toml.`);
      return;
    }

    for (const [index, pluginConfig] of config.plugins.entries()) {
      // The manifest is read without executing anything, which is the whole
      // point of it being static (§13.2) — `list` must work even for a plugin
      // that would fail to load.
      let summary: string;
      try {
        const { manifest } = await PluginLoader.resolve(PluginRegistry.directory(config), pluginConfig);
        summary =
          `silo ${manifest.silo} — contributes ` +
          PluginContributionUtils.summary(manifest.contributes);
      } catch (caught: any) {
        summary = `ERROR: ${caught.message}`;
      }
      const grant = await service.plugins.find(pluginConfig.name);
      const stored = grant?.granted ?? [];
      const effective = [...new Set([...pluginConfig.claims, ...stored])];

      // `disabled` sits beside the state rather than replacing it, because the
      // two are orthogonal (D38): a disabled plugin keeps whatever grant it had,
      // and an operator re-enabling one needs to know what it will come back
      // holding.
      const disabled = grant?.enabled === false ? ", disabled" : "";
      // `PluginGrantResolver.state`, not the record's raw state. The record only
      // ever describes the *store* half of the grant, so a plugin granted
      // entirely through `silo.toml` sits at `pending` there forever — and this
      // line printed `[pending]` directly above a `claims:` line listing what it
      // was running on. D40 fixed that in `/api/plugins`; the CLI said it too.
      const state = PluginGrantResolver.state(pluginConfig.claims, grant);
      console.log(`${index + 1}. ${pluginConfig.name}  [${state}${disabled}]`);
      console.log(`   ${summary}`);
      console.log(`   claims: ${effective.length > 0 ? effective.join(", ") : "(none)"}`);
      // Both halves named separately, because "why does it hold this?" has two
      // possible answers and only one of them is withdrawable with `revoke`.
      if (pluginConfig.claims.length > 0 && stored.length > 0) {
        console.log(`     from silo.toml: ${pluginConfig.claims.length}, granted: ${stored.length}`);
      }
      console.log(`   on_error: ${pluginConfig.on_error}, timeout: ${pluginConfig.timeout_ms}ms`);
      if (grant?.enabled === false) {
        console.log(`   → disabled: listed in silo.toml but not loaded`);
      } else if (effective.length === 0) {
        console.log(`   → awaiting approval: silo plugin grant ${pluginConfig.name}`);
      }
    }
  }

  private static async info(
    config: Config,
    service: SiloService,
    name: string | undefined
  ): Promise<void> {
    if (!name) {
      console.error(`usage: silo plugin info <name>`);
      process.exit(1);
    }
    const pluginConfig = config.plugins.find((p) => p.name === name);
    if (!pluginConfig) {
      console.error(`silo: no [[plugins]] entry named "${name}"`);
      process.exit(1);
    }

    const resolved = await PluginLoader.resolve(PluginRegistry.directory(config), pluginConfig);
    const { manifest } = resolved;

    console.log(`name      : ${manifest.name}`);
    console.log(`directory : ${resolved.dir}`);
    console.log(`entry     : ${resolved.entry}`);
    console.log(`requires  : silo ${manifest.silo}  (this is silo ${SiloVersion})`);
    console.log(`contributes: ${PluginContributionUtils.summary(manifest.contributes)}`);

    // The full request, derived claims included — a hook claim per declared hook
    // and `http:route` for declared routes are computed rather than restated in
    // the manifest (D34, D36), so printing only the declared permissions would
    // understate what is being asked for.
    const request = PluginGrantResolver.request(manifest);
    const grant = await service.plugins.find(pluginConfig.name);
    const effective = [...new Set([...pluginConfig.claims, ...(grant?.granted ?? [])])].sort();

    console.log(`state     : ${PluginGrantResolver.state(pluginConfig.claims, grant)}`);
    console.log(`holds     : ${effective.length > 0 ? effective.join(", ") : "(none)"}`);
    // Both halves named, because "why does it hold this?" has two answers and
    // only one of them is withdrawable with `revoke` (D34's union rule).
    if (pluginConfig.claims.length > 0 && (grant?.granted.length ?? 0) > 0) {
      console.log(
        `  from silo.toml: ${pluginConfig.claims.length}, granted: ${grant!.granted.length}`
      );
    }

    // Required and optional separately, with the author's reason, because that is
    // the decision: everything required is what a default grant approves, and an
    // ungranted optional is a normal outcome rather than an oversight (D36).
    PluginCommand.reportRequest("requires", request.required, request.reasons);
    const optional = request.claims.filter((claim) => !request.required.includes(claim));
    PluginCommand.reportRequest("also asks for", optional, request.reasons);

    const missing = PluginGrantUtils.missing(request.claims, effective);
    if (missing.length > 0) console.log(`not granted: ${missing.join(", ")}`);
    if (manifest.config !== undefined) {
      console.log(`config schema:\n${JSON.stringify(manifest.config, null, 2)}`);
      console.log(`config value:\n${JSON.stringify(pluginConfig.config, null, 2)}`);
    }
  }

  /** One request list, each claim followed by the author's reason for wanting
   *  it. Indented rather than tabulated, because a reason is a sentence and a
   *  column would either truncate it or make the claims unreadable. */
  private static reportRequest(
    label: string,
    claims: readonly string[],
    reasons: Record<string, string>
  ): void {
    if (claims.length === 0) return;
    console.log(`${label}:`);
    for (const claim of claims) {
      console.log(`  ${claim}`);
      const reason = reasons[claim];
      if (reason) console.log(`    ${reason}`);
    }
  }

  /**
   * Load everything the way `serve` would and report what breaks.
   *
   * Workers, not inline: the point is to reproduce what `serve` does, and an
   * inline load would silently pass a plugin whose worker cannot start.
   */
  private static async doctor(config: Config, service: SiloService): Promise<void> {
    if (config.plugins.length === 0) {
      console.log(`no plugins configured — nothing to check.`);
      return;
    }

    // Checked before loading, because a disabled plugin is skipped by the
    // loader and would therefore not appear in the report at all — silence
    // about a plugin `silo.toml` lists is exactly what `doctor` exists to
    // prevent (D38).
    let disabled = 0;
    for (const pluginConfig of config.plugins) {
      const grant = await service.plugins.find(pluginConfig.name);
      if (grant?.enabled !== false) continue;
      disabled++;
      console.log(`WARN ${pluginConfig.name} — disabled, not loaded`);
      console.log(`       POST /api/plugins/${pluginConfig.name}/enable`);
    }

    let registry: PluginRegistry | null = null;
    try {
      registry = await PluginRegistry.load(config, service, Logger.silent());

      // Loading is no longer the whole question (D34). A plugin awaiting
      // approval starts cleanly and receives nothing, which is exactly the
      // "runs, looks healthy, does nothing" outcome §13.3 refuses to let pass
      // silently — so `doctor` reports it and exits non-zero.
      let unauthorized = 0;
      for (const runtime of registry.list()) {
        const { state } = runtime.authority;
        const hooks = runtime.hooks.join(", ") || "no hooks";
        if (state === "pending" || state === "revoked") {
          unauthorized++;
          console.log(`WARN ${runtime.name}  (${hooks}) — ${state}, receives nothing`);
          console.log(`       silo plugin grant ${runtime.name}`);
        } else if (state === "needs_review") {
          unauthorized++;
          console.log(`WARN ${runtime.name}  (${hooks}) — asks for more than was approved`);
          console.log(`       not granted: ${runtime.authority.missing.join(", ")}`);
        } else {
          console.log(`ok   ${runtime.name}  (${hooks})`);
        }
      }

      console.log(`\n${registry.list().length} plugin(s) loaded. serve would start.`);
      if (unauthorized > 0) {
        console.error(`${unauthorized} plugin(s) are not fully authorized and will not do their job.`);
        process.exitCode = 1;
      }
      if (disabled > 0) {
        console.error(`${disabled} plugin(s) are configured but disabled.`);
        process.exitCode = 1;
      }
    } catch (caught: any) {
      console.error(`FAIL ${caught.message}`);
      console.error(`\nserve would refuse to start.`);
      process.exitCode = 1;
    } finally {
      await registry?.stop();
    }
  }
}
