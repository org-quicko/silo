import type { Config } from "../../config/config";
import type { Service } from "../../core/service/service";
import { Logger } from "../../logging/logger";
import { PluginLoader, PluginRegistry, ProviderRegistry } from "../../plugins";
import { SiloVersion } from "../../version";

/**
 * `silo plugin list | info | doctor` (D31/§13.8).
 *
 * All three are **read-only and offline**. There is no `add` or `remove` in
 * 1.0: shipping a package manager — registry resolution, integrity pinning, a
 * lockfile, a signature policy — is the largest and riskiest part of the plugin
 * design and none of it touches the contract, so it is §12.8 work. A plugin is
 * a directory you place under `<data dir>/plugins/` and name in `silo.toml`.
 *
 * `doctor` is the one that loads code, which is exactly what it is for: it
 * answers "would `serve` start?" without starting a server, in the same spirit
 * as `silo search reindex --check`.
 */
export class PluginCommand {
  static async run(cfg: Config, svc: Service, positionals: string[]): Promise<void> {
    const sub = positionals[1] ?? "list";

    switch (sub) {
      case "list":
        return await PluginCommand.list(cfg);
      case "info":
        return await PluginCommand.info(cfg, positionals[2]);
      case "doctor":
        return await PluginCommand.doctor(cfg, svc);
      default:
        console.error(`usage: silo plugin list | info <name> | doctor`);
        process.exit(1);
    }
  }

  private static async list(cfg: Config): Promise<void> {
    const drivers = ProviderRegistry.withBuiltins().drivers();
    console.log(`storage drivers: ${drivers.storage.join(", ")}`);
    console.log(`blob drivers   : ${drivers.blob.join(", ")}`);
    console.log(`plugins dir    : ${PluginRegistry.directory(cfg)}\n`);

    if (cfg.plugins.length === 0) {
      console.log(`no plugins configured. Add a [[plugins]] entry to silo.toml.`);
      return;
    }

    for (const [i, config] of cfg.plugins.entries()) {
      // The manifest is read without executing anything, which is the whole
      // point of it being static (§13.2) — `list` must work even for a plugin
      // that would fail to load.
      let summary: string;
      try {
        const { manifest } = await PluginLoader.resolve(PluginRegistry.directory(cfg), config);
        const attaches =
          manifest.kind === "provider"
            ? `provides ${manifest.provider!.port} driver "${manifest.provider!.driver}"`
            : manifest.hooks.join(", ");
        summary = `${manifest.kind}, silo ${manifest.silo} — ${attaches}`;
      } catch (err: any) {
        summary = `ERROR: ${err.message}`;
      }
      console.log(`${i + 1}. ${config.name}`);
      console.log(`   ${summary}`);
      console.log(`   claims: ${config.claims.length > 0 ? config.claims.join(", ") : "(none)"}`);
      console.log(`   on_error: ${config.on_error}, timeout: ${config.timeout_ms}ms`);
    }
  }

  private static async info(cfg: Config, name: string | undefined): Promise<void> {
    if (!name) {
      console.error(`usage: silo plugin info <name>`);
      process.exit(1);
    }
    const config = cfg.plugins.find((p) => p.name === name);
    if (!config) {
      console.error(`silo: no [[plugins]] entry named "${name}"`);
      process.exit(1);
    }

    const resolved = await PluginLoader.resolve(PluginRegistry.directory(cfg), config);
    const { manifest } = resolved;

    console.log(`name      : ${manifest.name}`);
    console.log(`kind      : ${manifest.kind}`);
    console.log(`directory : ${resolved.dir}`);
    console.log(`entry     : ${resolved.entry}`);
    console.log(`requires  : silo ${manifest.silo}  (this is silo ${SiloVersion})`);
    if (manifest.kind === "extension") {
      console.log(`hooks     : ${manifest.hooks.join(", ")}`);
    } else {
      console.log(`provides  : ${manifest.provider!.port} driver "${manifest.provider!.driver}"`);
    }
    console.log(`requests  : ${manifest.claims.length > 0 ? manifest.claims.join(", ") : "(no claims)"}`);
    console.log(`granted   : ${config.claims.length > 0 ? config.claims.join(", ") : "(none)"}`);
    if (manifest.config !== undefined) {
      console.log(`config schema:\n${JSON.stringify(manifest.config, null, 2)}`);
      console.log(`config value:\n${JSON.stringify(config.config, null, 2)}`);
    }
  }

  /**
   * Load everything the way `serve` would and report what breaks.
   *
   * Workers, not inline: the point is to reproduce what `serve` does, and an
   * inline load would silently pass a plugin whose worker cannot start.
   */
  private static async doctor(cfg: Config, svc: Service): Promise<void> {
    if (cfg.plugins.length === 0) {
      console.log(`no plugins configured — nothing to check.`);
      return;
    }

    let registry: PluginRegistry | null = null;
    try {
      registry = await PluginRegistry.load(cfg, svc, Logger.silent());
      for (const runtime of registry.list()) {
        console.log(`ok   ${runtime.name}  (${runtime.hooks.join(", ") || "no hooks"})`);
      }
      console.log(`\n${registry.list().length} plugin(s) loaded. serve would start.`);
    } catch (err: any) {
      console.error(`FAIL ${err.message}`);
      console.error(`\nserve would refuse to start.`);
      process.exitCode = 1;
    } finally {
      await registry?.stop();
    }
  }
}
