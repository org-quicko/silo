import { PluginRoutes } from "./plugin-routes";
import type { PluginContributions } from "./plugin-contributions";

/** The questions every reader of a `contributes` block asks, in one place. */
export class PluginContributionUtils {
  /**
   * Whether this package needs a `Worker` at all.
   *
   * The three worker-side contributions are hooks, routes and a runtime, and any
   * one of them is enough. A provider is deliberately absent: it is constructed
   * in-process before storage exists, so a package contributing only providers
   * has nothing to start and no grant record to keep (§13.7).
   */
  static runsInWorker(contributes: PluginContributions): boolean {
    return contributes.hooks.length > 0 || contributes.routes.length > 0 || contributes.runtime;
  }

  /** A package nothing would ever call. Refused at the manifest, because it
   *  loads, looks healthy and does nothing. */
  static declaresNothing(contributes: PluginContributions): boolean {
    return (
      !PluginContributionUtils.runsInWorker(contributes) && contributes.providers.length === 0
    );
  }

  /**
   * One line naming what a package contributes, for `silo plugin list|info` and
   * `silo add`.
   *
   * Every contribution it has, not the first one that matched. The point of the
   * list replacing `kind` is that a package can do more than one thing, so a
   * summary reporting one of them would reintroduce exactly the blind spot.
   */
  static summary(contributes: PluginContributions): string {
    const parts: string[] = [];
    if (contributes.hooks.length > 0) parts.push(`hooks ${contributes.hooks.join(", ")}`);
    if (contributes.routes.length > 0) {
      parts.push(`routes ${PluginRoutes.keys(contributes.routes).join(", ")}`);
    }
    if (contributes.runtime) parts.push("a runtime (activate/deactivate)");
    for (const provider of contributes.providers) {
      parts.push(`${provider.port} driver "${provider.driver}"`);
    }
    return parts.length === 0 ? "nothing" : parts.join("; ");
  }
}
