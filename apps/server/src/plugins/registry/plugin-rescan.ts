import type { Config } from "../../config/config";
import type { PluginConfig } from "../../config/plugin-config";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import type { ResolvedPlugin } from "../manifest";
import type { PluginRuntime } from "../runtime";
import { PluginLoader } from "./plugin-loader";
import type { PluginLifecycle } from "./plugin-lifecycle";
import type { PluginRegistry } from "./plugin-registry";
import type { RescanReport } from "./rescan-report";

/**
 * Make the running set match `silo.toml` again, without a restart (D39,
 * phase 4).
 *
 * D38 deferred this along with `PATCH .../config` because both need a manifest
 * read from disk and neither *takes effect* without a supervisor — an API whose
 * whole answer is "restart to find out". With one, it is the verb that makes the
 * operator's file authoritative at any moment rather than only at boot: a plugin
 * added, removed or reordered, a package upgraded in place, or a grant made
 * offline with `silo plugin grant` against a data directory a server is already
 * serving.
 *
 * A plugin already running with nothing changed is **left alone**. Restarting
 * everything would be simpler and is what a naive reload does; it also throws
 * away in-flight dispatches and any state a plugin built up, on every rescan,
 * for plugins the operator did not touch.
 */
export class PluginRescan {
  static async run(options: {
    lifecycle: PluginLifecycle;
    registry: PluginRegistry;
    config: Config;
  }): Promise<RescanReport> {
    const { lifecycle, registry, config } = options;
    const report: RescanReport = {
      started: [],
      restarted: [],
      stopped: [],
      unchanged: [],
      skipped: [],
      failed: [],
      order: [],
    };

    const before = registry.list();
    const next: PluginRuntime[] = [];

    for (const declared of config.plugins) {
      const running = before.find((runtime) => runtime.name === declared.name);
      try {
        const kept = await PluginRescan.reconcileOne(options, declared, running, report);
        if (kept) next.push(kept);
      } catch (caught) {
        // Reported, not thrown. Refusing the whole rescan over one bad package
        // would abandon every other change in the file to a plugin the operator
        // may not have touched — and the next `serve` still refuses to start,
        // which is the fact the report carries.
        report.failed.push({ name: declared.name, error: (caught as Error).message });
      }
    }

    // Everything that was running and is not in the new set, torn down after
    // that set is decided so a failure above cannot leave the instance with
    // neither. `stopped` names only the ones the file no longer lists — a plugin
    // that was restarted, disabled or failed is already reported as that, and
    // counting it twice would make the report a puzzle.
    for (const runtime of before) {
      if (next.includes(runtime)) continue;
      if (!config.plugins.some((plugin) => plugin.name === runtime.name)) {
        report.stopped.push(runtime.name);
      }
      await runtime.stop().catch(() => {});
    }

    registry.replace(next);
    report.order = next.map((runtime) => runtime.name);
    return report;
  }

  /**
   * One plugin: keep it, restart it, start it, or skip it.
   *
   * The runtime that comes back is the one that belongs in the new set, or
   * `null` when nothing should be running for this name. A plugin that is
   * restarted is *not* stopped here — the caller stops everything the new set
   * does not contain, which keeps the tear-down in one place.
   */
  private static async reconcileOne(
    options: { lifecycle: PluginLifecycle; config: Config },
    declared: PluginConfig,
    running: PluginRuntime | undefined,
    report: RescanReport
  ): Promise<PluginRuntime | null> {
    const { lifecycle, config } = options;
    const prepared = await PluginLoader.prepare(lifecycle.context(config), declared);

    // A provider is the storage, and swapping it would mean swapping an open
    // database underneath every in-flight write. A rescan says so rather than
    // pretending it applied.
    if (!prepared) {
      report.skipped.push({
        name: declared.name,
        reason: "a provider — the storage or blob driver, which only a restart can change",
      });
      return null;
    }

    if (prepared.grant.enabled === false) {
      report.skipped.push({ name: declared.name, reason: "disabled" });
      return null;
    }

    if (running && !PluginRescan.changed(running, declared, prepared)) {
      // Nothing it was *started* with moved, but the grant may have: an offline
      // `silo plugin grant` is one of the two reasons to run a rescan at all.
      lifecycle.reapply(declared.name, prepared.grant);
      report.unchanged.push(declared.name);
      return running;
    }

    const started = await lifecycle.start(config, declared);
    if (running) report.restarted.push(declared.name);
    else report.started.push(declared.name);
    return started;
  }

  /**
   * Whether anything the worker was **started with** has moved.
   *
   * Deliberately not "did anything about this plugin change" — a grant did not,
   * because authority is swapped in place and never needs a restart. What needs
   * one is anything that crosses to the worker exactly once: the module on disk,
   * the declared hooks, the config document, and the dispatch bounds the host
   * holds.
   */
  private static changed(
    running: PluginRuntime,
    declared: PluginConfig,
    prepared: { resolved: ResolvedPlugin; grant: PluginGrantRecord }
  ): boolean {
    if (running.plugin.entry !== prepared.resolved.entry) return true;
    if (JSON.stringify(running.plugin.manifest) !== JSON.stringify(prepared.resolved.manifest)) {
      return true;
    }
    if (running.config.timeout_ms !== declared.timeout_ms) return true;
    if (running.config.on_error !== declared.on_error) return true;
    if (JSON.stringify(running.config.claims) !== JSON.stringify(declared.claims)) return true;

    const effective = PluginGrantUtils.configFor(prepared.grant, declared.config);
    return JSON.stringify(running.runtimeConfig) !== JSON.stringify(effective);
  }
}
