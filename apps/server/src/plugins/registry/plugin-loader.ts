import { Claims } from "@silo/shared/claims";
import { SiloVersion } from "../../version";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import { ManifestReader } from "../manifest";
import { PluginConfigValidator } from "../manifest";
import { PluginContext } from "../runtime";
import { HookBus } from "../runtime";
import { WorkerHost } from "../host";
import { PluginRuntime } from "../runtime";
import { SiloApi } from "../host";
import { VersionRange } from "../manifest";
import type { PluginManifest } from "../manifest";
import { PluginRoutes } from "../manifest";
import type { ResolvedPlugin } from "../manifest";
import type { ProviderRegistry } from "./provider-registry";
import { PluginAuthority } from "./plugin-authority";
import { PluginGrantResolver } from "./plugin-grant-resolver";
import type { PluginLoadContext } from "./plugin-load-context";
import type { ResolvedGrant } from "./resolved-grant";

export interface ExtensionLoadOptions extends PluginLoadContext {
  configs: readonly PluginConfig[];
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
 *
 * Since phase 4 it also starts **one** plugin at a time, for `PluginSupervisor`.
 * `start` is the shared body: enabling a plugin on a running instance has to
 * reach exactly the checks a boot does, or the two would disagree about which
 * packages are loadable and an operator would discover the difference at the
 * next restart.
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
      const prepared = await PluginLoader.prepare(options, config);
      if (!prepared) continue;

      // Reconciled first and *then* skipped, so a disabled plugin still has a
      // record to re-enable through. Loud, because `silo.toml` lists it and it
      // is not running: that divergence is §13.3's least favourite state, and it
      // is tolerable here only because it is recorded rather than inferred
      // (D38). Since phase 4 it is also undone without a restart, which is why
      // the remedy no longer mentions one.
      if (prepared.grant.enabled === false) {
        options.logger.warn("plugin is disabled and was not loaded", {
          plugin: config.name,
          remedy: `POST /api/plugins/${config.name}/enable`,
        });
        continue;
      }

      runtimes.push(
        await PluginLoader.start(
          options,
          config,
          prepared.resolved,
          prepared.grant,
          PluginGrantUtils.configFor(prepared.grant, config.config)
        )
      );
    }

    return runtimes;
  }

  /**
   * Read the manifest and bring the `_plugins` record in line with it, without
   * running anything.
   *
   * `null` for a provider, which has no runtime to prepare. Reconciling happens
   * here rather than inside `start` because the record it returns is what
   * decides whether `start` is called at all — there is nothing to grant through
   * the API or the UI until a record exists (D34).
   */
  static async prepare(
    context: PluginLoadContext,
    config: PluginConfig
  ): Promise<{ resolved: ResolvedPlugin; grant: PluginGrantRecord } | null> {
    const resolved = await PluginLoader.resolve(context.pluginsDir, config);
    if (resolved.manifest.kind !== "extension") return null;

    const grant = await context.service.plugins.reconcile(
      config.name,
      PluginGrantResolver.requested(resolved.manifest),
      resolved.manifest.hooks
    );
    return { resolved, grant };
  }

  /**
   * Start one prepared plugin's worker and hand back its runtime.
   *
   * Deliberately unaware of `enabled`: the caller decides whether a plugin
   * should be running, and the supervisor's `enable` calls this *before* writing
   * the record it is about to flip. That ordering is not an accident — see
   * `PluginSupervisor`.
   *
   * `runtimeConfig` is passed rather than derived, and that is the same story
   * one level down. It is usually `PluginGrantUtils.configFor(grant, …)`, but
   * `PATCH .../config` restarts *before* it writes, so at that moment the record
   * still holds the previous override and deriving from it would start the
   * plugin on the config the operator just replaced.
   */
  static async start(
    context: PluginLoadContext,
    config: PluginConfig,
    resolved: ResolvedPlugin,
    grant: PluginGrantRecord | null,
    runtimeConfig: Record<string, unknown>
  ): Promise<PluginRuntime> {
    const authority = PluginGrantResolver.resolve(config, resolved.manifest, grant);
    PluginLoader.assertDeliverable(config.name, authority);
    PluginLoader.assertServable(config.name, resolved.manifest, authority);

    // The document that actually reaches the worker, which is not always the
    // one `resolve` checked: `resolve` sees what `silo.toml` declared, and a
    // stored override (D39) has to meet the same schema before its plugin runs
    // on it. The same validator, called about a different document.
    PluginConfigValidator.validate(resolved.manifest, runtimeConfig);

    const cell = new PluginAuthority(authority);
    const pluginContext = new PluginContext({
      name: config.name,
      authority: cell,
      dispatcher: context.dispatcher,
      logger: context.logger,
      maxDepth: HookBus.MaxDepth,
    });

    // Always a worker (§13.4). The isolation choice is not the operator's:
    // it is the only host where `timeout_ms` means anything.
    const host = new WorkerHost({
      name: config.name,
      entry: resolved.entry,
      config: runtimeConfig,
      declared: resolved.manifest.hooks,
      routes: PluginRoutes.keys(resolved.manifest.routes),
      timeoutMs: config.timeout_ms,
      rpc: pluginContext,
    });
    const hooks = await host.start();

    PluginLoader.report(context, config.name, authority, hooks);
    return new PluginRuntime(resolved, config, host, hooks, cell, runtimeConfig);
  }

  /** Loud on every start, because a plugin awaiting approval is running,
   *  healthy and doing nothing — §13.3's least favourite outcome. It is not a
   *  refused start only because granting needs a server to grant through (D34),
   *  so the log is what carries the fact instead. */
  private static report(
    context: PluginLoadContext,
    name: string,
    authority: ResolvedGrant,
    hooks: readonly string[]
  ): void {
    if (authority.state === "pending" || authority.state === "revoked") {
      context.logger.warn("plugin is not authorized and will receive nothing", {
        plugin: name,
        state: authority.state,
        remedy: `silo plugin grant ${name}`,
      });
    } else if (authority.state === "needs_review") {
      context.logger.warn("plugin asks for more than was approved", {
        plugin: name,
        unapproved: authority.missing.join(","),
        remedy: `silo plugin info ${name}`,
      });
    }

    context.logger.info("plugin loaded", {
      plugin: name,
      hooks: hooks.join(","),
      state: authority.state,
      claims: authority.claims.length,
    });
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

  /**
   * Declared routes with no `http:route` refuse the start (D36, phase 6).
   *
   * The same argument as `assertDeliverable`, one capability over. A plugin
   * whose routes all answer 403 is running, healthy, and not doing the thing it
   * was installed for — and the failure surfaces to whoever *calls* the route
   * rather than to the operator who deployed it, which is the wrong person and
   * usually much later.
   *
   * Exempt while awaiting approval, for the same boot-deadlock reason: granting
   * needs a server to grant through.
   */
  private static assertServable(
    name: string,
    manifest: PluginManifest,
    authority: ResolvedGrant
  ): void {
    if (manifest.routes.length === 0) return;
    if (authority.claims.length === 0) return;
    if (Claims.has(authority.claims, Claims.HttpRoute)) return;

    throw new Error(
      `plugin "${name}": declares ${manifest.routes.length} ` +
        `route${manifest.routes.length === 1 ? "" : "s"} ` +
        `(${PluginRoutes.keys(manifest.routes).join(", ")}) but is not granted ` +
        `"${Claims.HttpRoute}", so every one of them would answer 403. ` +
        `Add "${Claims.HttpRoute}" to the plugin's "claims" in silo.toml, ` +
        `or approve it through the plugins API.`
    );
  }
}
