import { PluginRouteBodies } from "./plugin-route-bodies";
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

  /**
   * A package nothing would ever call. Refused at the manifest, because it
   *  loads, looks healthy and does nothing.
   *
   * A panel counts (D41). It is not worker-side and it reaches nothing on its
   * own, so it does not make a package *run* — but something does render it, and
   * the question this asks is whether anything would ever call the package, not
   * whether a worker would start. A package contributing only a panel is a
   * static screen: unusual, since a panel with no routes of its own can only
   * display what it was shipped with, and legal, because refusing it would be
   * this function answering a question about taste.
   */
  static declaresNothing(contributes: PluginContributions): boolean {
    return (
      !PluginContributionUtils.runsInWorker(contributes) &&
      contributes.providers.length === 0 &&
      contributes.ui === null
    );
  }

  /**
   * The shortest true answer to "what is this package", for a status line.
   *
   * `silo plugin doctor` printed a plugin's **hooks** and nothing else, so a
   * package contributing routes, a runtime and a panel read as `(no hooks)` — a
   * report that sounds like a fault about a plugin doing exactly what it declared.
   * That is D36's complaint about `kind` in the one surface D36 did not revisit,
   * and the fix is the same: name every contribution rather than the one field the
   * caller happened to have.
   */
  static label(contributes: PluginContributions): string {
    const parts: string[] = [];
    if (contributes.hooks.length > 0) parts.push(`hooks: ${contributes.hooks.join(", ")}`);
    if (contributes.routes.length > 0) parts.push(`${contributes.routes.length} routes`);
    if (contributes.runtime) parts.push("runtime");
    if (contributes.providers.length > 0) parts.push(`${contributes.providers.length} providers`);
    if (contributes.ui) parts.push("panel");
    return parts.length === 0 ? "contributes nothing" : parts.join(" · ");
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
      // A non-default body is named here rather than left to the route list,
      // because it is the one property of a route that costs the *operator*
      // something: it is how much the host will allocate for whoever reaches it.
      const routes = contributes.routes.map((route) => {
        const key = PluginRoutes.key(route);
        return PluginRouteBodies.isDefault(route.body)
          ? key
          : `${key} (${PluginRouteBodies.phrase(route.body)})`;
      });
      parts.push(`routes ${routes.join(", ")}`);
    }
    if (contributes.runtime) parts.push("a runtime (activate/deactivate)");
    for (const provider of contributes.providers) {
      parts.push(`${provider.port} driver "${provider.driver}"`);
    }
    if (contributes.ui) parts.push(`an admin panel (${contributes.ui.entry})`);
    return parts.length === 0 ? "nothing" : parts.join("; ");
  }
}
