import { Claims } from "@silo/shared/claims";
import { SiloVersion } from "../../version";
import type { PluginConfig } from "../../config/plugin-config";
import type { Service } from "../../core/service/service";
import type { Logger } from "../../logging/logger";
import { ManifestReader } from "../manifest";
import { PluginConfigValidator } from "../manifest";
import { PluginContext } from "../runtime";
import { HookBus } from "../runtime";
import { WorkerHost } from "../host";
import { PluginRuntime } from "../runtime";
import { SiloApi } from "../host";
import { VersionRange } from "../manifest";
import type { ResolvedPlugin } from "../manifest";
import type { ProviderRegistry } from "./provider-registry";

export interface ExtensionLoadOptions {
  pluginsDir: string;
  configs: readonly PluginConfig[];
  svc: Service;
  logger: Logger;
}

/**
 * Turns configured plugin names into running plugins (D31/§13.3).
 *
 * Everything it can refuse, it refuses **at startup**: a missing directory, a
 * `silo` range that excludes this binary, invalid config, a claim the manifest
 * asked for that the operator did not grant, a declared hook the module does
 * not export. None of those is skipped with a warning, because a skipped plugin
 * leaves an instance that runs, looks healthy, and has quietly stopped doing
 * whatever the plugin was installed to do.
 */
export class PluginLoader {
  /**
   * Provider plugins, loaded before storage is opened — they *are* the storage.
   *
   * They never go through `PluginHost`: a provider is constructed, not
   * dispatched, so a port built for hook dispatch would be the wrong shape and
   * a second unused code path.
   */
  static async loadProviders(
    pluginsDir: string,
    configs: readonly PluginConfig[],
    registry: ProviderRegistry
  ): Promise<string[]> {
    const loaded: string[] = [];
    SiloApi.register();

    for (const config of configs) {
      const resolved = await PluginLoader.resolve(pluginsDir, config);
      if (resolved.manifest.kind !== "provider") continue;

      const mod = await import(Bun.pathToFileURL(resolved.entry).href);
      const create = mod?.default?.create;
      if (typeof create !== "function") {
        throw new Error(
          `plugin "${config.name}": a provider plugin must default-export { create(config) }.`
        );
      }

      const { port, driver } = resolved.manifest.provider!;
      if (port === "storage") {
        registry.registerStorage(driver, (cfg) => create(config.config, cfg), config.name);
      } else {
        registry.registerBlob(driver, (cfg) => create(config.config, cfg), config.name);
      }
      loaded.push(config.name);
    }
    return loaded;
  }

  /** Extension plugins, loaded after `Service` exists — their context calls
   *  back into it. */
  static async loadExtensions(options: ExtensionLoadOptions): Promise<PluginRuntime[]> {
    const runtimes: PluginRuntime[] = [];

    for (const config of options.configs) {
      const resolved = await PluginLoader.resolve(options.pluginsDir, config);
      if (resolved.manifest.kind !== "extension") continue;

      const context = new PluginContext(
        config.name,
        config.claims,
        options.svc,
        options.logger,
        HookBus.MaxDepth
      );

      const hostOptions = {
        name: config.name,
        entry: resolved.entry,
        config: config.config,
        declared: resolved.manifest.hooks,
        timeoutMs: config.timeout_ms,
        rpc: context,
      };

      // Always a worker (§13.4). The isolation choice is not the operator's:
      // it is the only host where `timeout_ms` means anything.
      const host = new WorkerHost(hostOptions);
      const hooks = await host.start();

      options.logger.info("plugin loaded", {
        plugin: config.name,
        hooks: hooks.join(","),
      });
      runtimes.push(new PluginRuntime(resolved, config, host, context, hooks));
    }

    return runtimes;
  }

  /** Read the manifest and run every check that does not need the module. Used
   *  by both load paths and by `silo plugin doctor`. */
  static async resolve(pluginsDir: string, config: PluginConfig): Promise<ResolvedPlugin> {
    const resolved = await ManifestReader.read(pluginsDir, config.name);
    const { manifest } = resolved;

    // Against SiloVersion, because there is no separate plugin API version
    // (D31, D13). The `-dev` suffix every non-release build carries is dropped
    // before the comparison — see VersionRange.
    if (!PluginLoader.compatible(manifest.silo)) {
      throw new Error(
        `plugin "${config.name}": needs silo ${manifest.silo}, but this is silo ${SiloVersion}.`
      );
    }

    PluginConfigValidator.validate(manifest, config.config);
    PluginLoader.assertGranted(config, manifest.claims);
    return resolved;
  }

  /** Whether this binary satisfies a manifest's range. Reads the imported
   *  `SiloVersion` constant rather than a literal, per D28, so a release build
   *  and a dev build answer identically for the same tree. */
  static compatible(range: string): boolean {
    return VersionRange.satisfies(SiloVersion, range);
  }

  /**
   * Every claim the manifest asked for must be covered by what the operator
   * granted.
   *
   * Refused rather than warned, because the alternative fails much later and
   * much worse: the plugin loads, runs, and throws a `ForbiddenError` from
   * inside a hook the first time a write touches the collection it cares
   * about — which surfaces as a 403 on someone else's request, naming a claim
   * nobody was looking at.
   */
  private static assertGranted(config: PluginConfig, requested: readonly string[]): void {
    const missing = requested.filter((claim) => !Claims.has(config.claims, claim as any));
    if (missing.length === 0) return;

    throw new Error(
      `plugin "${config.name}": requests ${missing.join(", ")}, which this instance does not grant. ` +
        `Add them to the plugin's "claims" in silo.toml, or remove the plugin.`
    );
  }
}
