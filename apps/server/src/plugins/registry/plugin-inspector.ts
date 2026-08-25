import type { Config } from "../../config/config";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import { PluginGrantResolver } from "./plugin-grant-resolver";
import type { ResolvedPlugin } from "../manifest";
import type { PluginRuntime } from "../runtime";
import type { PluginFacts } from "./plugin-facts";
import { PluginLoader } from "./plugin-loader";
import { PluginRegistry } from "./plugin-registry";
import type { PluginStatus } from "./plugin-status";

/** One plugin's package as this pass found it, so the reasons below are read
 *  from a single lookup rather than four. */
interface Sighting {
  runtime: PluginRuntime | undefined;
  declared: PluginConfig | undefined;
  resolved: ResolvedPlugin | null;
  failure: Error | null;
}

/**
 * What a plugin is *doing*, what it *declares*, and what config it runs with
 * (D39, phase 4; the manifest half is D40).
 *
 * Separate from `PluginSupervisor` because they answer opposite questions. The
 * supervisor changes the running set and owns every rule about the order its
 * steps happen in; this reads it and changes nothing. Keeping them apart is what
 * lets the supervisor be a file about ordering and rollback, with no reporting
 * in it.
 */
export class PluginInspector {
  /**
   * Every fact about one plugin the record cannot carry, from **one** read of
   * the package.
   *
   * Async for a reason that is not incidental: the honest answer for a plugin
   * that is not running depends on *why*, and one of the reasons — it is a
   * provider, which is the storage and has no worker at all — is knowable only
   * from the manifest on disk. A surface that guessed there would be reporting
   * "not loaded" about a plugin that is, by construction, doing its job.
   */
  static async inspect(
    config: Config,
    registry: PluginRegistry,
    name: string,
    record: PluginGrantRecord | null
  ): Promise<PluginFacts> {
    const sighting = await PluginInspector.sight(config, registry, name);
    const configClaims = sighting.declared?.claims ?? [];
    return {
      status: PluginInspector.state(name, record, sighting),
      config_claims: [...configClaims],
      effective: PluginGrantResolver.effective(configClaims, record),
      state: PluginGrantResolver.state(configClaims, record),
      manifest: sighting.resolved
        ? {
            kind: sighting.resolved.manifest.kind,
            config_schema: sighting.resolved.manifest.config ?? null,
            routes: sighting.resolved.manifest.routes,
          }
        : null,
      ...PluginInspector.config(config, name, record),
    };
  }

  /** Running, stopped, or failed — and why, when it is not running. */
  static async status(
    config: Config,
    registry: PluginRegistry,
    name: string,
    record: PluginGrantRecord | null
  ): Promise<PluginStatus> {
    return (await PluginInspector.inspect(config, registry, name, record)).status;
  }

  /** The config document in force, and which source won. Both halves, because
   *  an override makes `silo.toml`'s block stop applying and "this is not what
   *  my file says" is the support question that creates. */
  static config(
    config: Config,
    name: string,
    record: PluginGrantRecord | null
  ): { config: Record<string, unknown>; source: "silo.toml" | "store" } {
    const declared = config.plugins.find((plugin) => plugin.name === name);
    return {
      config: PluginGrantUtils.configFor(record, declared?.config ?? {}),
      source: record?.config === undefined ? "silo.toml" : "store",
    };
  }

  /**
   * A running plugin already holds the manifest it loaded from, so the disk is
   * read only for one that is not — and an unlisted plugin is not read at all,
   * since `silo.toml` is what says where to look.
   */
  private static async sight(
    config: Config,
    registry: PluginRegistry,
    name: string
  ): Promise<Sighting> {
    const runtime = registry.find(name);
    const declared = config.plugins.find((plugin) => plugin.name === name);
    if (runtime) return { runtime, declared, resolved: runtime.plugin, failure: null };
    if (!declared) return { runtime, declared, resolved: null, failure: null };

    try {
      const resolved = await PluginLoader.resolve(PluginRegistry.directory(config), declared);
      return { runtime, declared, resolved, failure: null };
    } catch (caught) {
      return { runtime, declared, resolved: null, failure: caught as Error };
    }
  }

  private static state(
    name: string,
    record: PluginGrantRecord | null,
    { runtime, declared, resolved, failure }: Sighting
  ): PluginStatus {
    if (runtime) return runtime.status();

    const stopped = (detail: string): PluginStatus => ({ state: "stopped", hooks: [], detail });
    if (!declared) {
      return stopped(
        `not listed in silo.toml, so nothing loads it. Its grant is kept and applies again ` +
          `the moment it is listed.`
      );
    }
    // After the listing check, because a plugin that is both disabled and no
    // longer listed is blocked by the second: of two true reasons, the report
    // gives the one that is actionable.
    if (record?.enabled === false) {
      return stopped(`disabled — POST /api/plugins/${name}/enable starts it`);
    }
    if (failure) return { state: "failed", hooks: [], detail: failure.message };

    if (resolved && resolved.manifest.kind === "provider") {
      const { port, driver } = resolved.manifest.provider!;
      return stopped(
        `a provider, not an extension: it is the ${port} driver "${driver}" and runs ` +
          `in-process with no worker of its own.`
      );
    }
    return stopped(`listed but not loaded — POST /api/plugins/rescan loads it`);
  }
}
