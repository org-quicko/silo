import type { Config } from "../../config/config";
import type { SiloService } from "../../core/services/silo-service";
import { Logger } from "../../logging/logger";
import { PluginLoader, PluginRegistry, ProviderRegistry } from "../../plugins";
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
  static async run(config: Config, service: SiloService, positionals: string[]): Promise<void> {
    const sub = positionals[1] ?? "list";

    switch (sub) {
      case "list":
        return await PluginCommand.list(config);
      case "info":
        return await PluginCommand.info(config, positionals[2]);
      case "doctor":
        return await PluginCommand.doctor(config, service);
      default:
        console.error(`usage: silo plugin list | info <name> | doctor | add <spec>`);
        process.exit(1);
    }
  }

  private static async list(config: Config): Promise<void> {
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
        const attaches =
          manifest.kind === "provider"
            ? `provides ${manifest.provider!.port} driver "${manifest.provider!.driver}"`
            : manifest.hooks.join(", ");
        summary = `${manifest.kind}, silo ${manifest.silo} — ${attaches}`;
      } catch (caught: any) {
        summary = `ERROR: ${caught.message}`;
      }
      console.log(`${index + 1}. ${pluginConfig.name}`);
      console.log(`   ${summary}`);
      console.log(`   claims: ${pluginConfig.claims.length > 0 ? pluginConfig.claims.join(", ") : "(none)"}`);
      console.log(`   on_error: ${pluginConfig.on_error}, timeout: ${pluginConfig.timeout_ms}ms`);
    }
  }

  private static async info(config: Config, name: string | undefined): Promise<void> {
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
    console.log(`granted   : ${pluginConfig.claims.length > 0 ? pluginConfig.claims.join(", ") : "(none)"}`);
    if (manifest.config !== undefined) {
      console.log(`config schema:\n${JSON.stringify(manifest.config, null, 2)}`);
      console.log(`config value:\n${JSON.stringify(pluginConfig.config, null, 2)}`);
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

    let registry: PluginRegistry | null = null;
    try {
      registry = await PluginRegistry.load(config, service, Logger.silent());
      for (const runtime of registry.list()) {
        console.log(`ok   ${runtime.name}  (${runtime.hooks.join(", ") || "no hooks"})`);
      }
      console.log(`\n${registry.list().length} plugin(s) loaded. serve would start.`);
    } catch (caught: any) {
      console.error(`FAIL ${caught.message}`);
      console.error(`\nserve would refuse to start.`);
      process.exitCode = 1;
    } finally {
      await registry?.stop();
    }
  }
}
