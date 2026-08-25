import { Claims } from "@silo/shared/claims";
import { SiloVersion } from "../../version";
import type { PluginConfig } from "../../config/plugin-config";
import type { SiloService } from "../../core/services/silo-service";
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
import { PluginGrantResolver } from "./plugin-grant-resolver";
import type { ResolvedGrant } from "./resolved-grant";

export interface ExtensionLoadOptions {
  pluginsDir: string;
  configs: readonly PluginConfig[];
  service: SiloService;
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
        registry.registerStorage(driver, (hostConfig) => create(config.config, hostConfig), config.name);
      } else {
        registry.registerBlob(driver, (blobConfig) => create(config.config, blobConfig), config.name);
      }
      loaded.push(config.name);
    }
    return loaded;
  }

  /** Extension plugins, loaded after `SiloService` exists — their context calls
   *  back into it. */
  static async loadExtensions(options: ExtensionLoadOptions): Promise<PluginRuntime[]> {
    const runtimes: PluginRuntime[] = [];

    for (const config of options.configs) {
      const resolved = await PluginLoader.resolve(options.pluginsDir, config);
      if (resolved.manifest.kind !== "extension") continue;

      // Reconciled before the worker starts, so `_plugins` describes what is
      // installed even for a plugin nobody has approved — there is nothing to
      // grant through the API or the UI until a record exists (D34).
      const grant = await options.service.plugins.reconcile(
        config.name,
        PluginGrantResolver.requested(resolved.manifest),
        resolved.manifest.hooks
      );

      // Reconciled first and *then* skipped, so a disabled plugin still has a
      // record to re-enable through — the same reason reconcile runs before the
      // worker starts. Loud, because `silo.toml` lists it and it is not running:
      // that divergence is §13.3's least favourite state, and it is tolerable
      // here only because it is recorded rather than inferred (D38).
      if (grant.enabled === false) {
        options.logger.warn("plugin is disabled and was not loaded", {
          plugin: config.name,
          remedy: `POST /api/plugins/${config.name}/enable`,
        });
        continue;
      }

      const authority = PluginGrantResolver.resolve(config, resolved.manifest, grant);
      PluginLoader.assertDeliverable(config.name, authority);

      const context = new PluginContext(
        config.name,
        authority.claims,
        options.service,
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

      // Loud on every start, because a plugin awaiting approval is running,
      // healthy and doing nothing — §13.3's least favourite outcome. It is not
      // a refused start only because granting needs a server to grant through
      // (D34), so the log is what carries the fact instead.
      if (authority.state === "pending" || authority.state === "revoked") {
        options.logger.warn("plugin is not authorized and will receive nothing", {
          plugin: config.name,
          state: authority.state,
          remedy: `silo plugin grant ${config.name}`,
        });
      } else if (authority.state === "needs_review") {
        options.logger.warn("plugin asks for more than was approved", {
          plugin: config.name,
          unapproved: authority.missing.join(","),
          remedy: `silo plugin info ${config.name}`,
        });
      }

      options.logger.info("plugin loaded", {
        plugin: config.name,
        hooks: hooks.join(","),
        state: authority.state,
        claims: authority.claims.length,
      });
      runtimes.push(new PluginRuntime(resolved, config, host, hooks, authority));
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
    return resolved;
  }

  /** Whether this binary satisfies a manifest's range. Reads the imported
   *  `SiloVersion` constant rather than a literal, per D28, so a release build
   *  and a dev build answer identically for the same tree. */
  static compatible(range: string): boolean {
    return VersionRange.satisfies(SiloVersion, range);
  }

  /**
   * A declared hook that no granted claim permits **anywhere** refuses the
   * start (D34).
   *
   * A missing *API* claim is not an error — a plugin may run on less than it
   * asked for — but a hook it can never be delivered is different in kind: the
   * plugin loads, looks healthy, and its whole reason to exist never fires.
   * Deriving delivery from the absence of a claim was the alternative, and it
   * is the mistake D30 refused when it declined to infer a public collection
   * from a missing declaration: nothing has been said about it, so nothing may
   * be assumed.
   *
   * A plugin awaiting approval is exempt, because it has no claims yet by
   * definition and refusing here would be the boot deadlock D34 exists to
   * avoid — the startup log carries that case instead.
   */
  private static assertDeliverable(name: string, authority: ResolvedGrant): void {
    if (authority.claims.length === 0) return;
    if (authority.undeliverable.length === 0) return;

    const lines = authority.undeliverable
      .map((hook) => `  "${Claims.hook("*", "*", "*", hook)}",`)
      .join("\n");
    throw new Error(
      `plugin "${name}": declares ${authority.undeliverable.join(", ")} but is granted no ` +
        `claim that delivers ${authority.undeliverable.length === 1 ? "it" : "them"} in any ` +
        `scope, so ${authority.undeliverable.length === 1 ? "it" : "they"} would never fire. ` +
        `Add to the plugin's "claims" in silo.toml (narrow the scopes to taste):\n${lines}`
    );
  }
}
