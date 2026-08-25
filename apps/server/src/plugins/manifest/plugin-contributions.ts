import type { HookName } from "../../core/hooks";
import type { PluginProvider } from "./plugin-provider";
import type { PluginRoute } from "./plugin-route";

/**
 * Everything a package contributes to a running silo (D36).
 *
 * This replaced `kind: "extension" | "provider"`, which was mutually exclusive
 * and wrong in both directions: it forced a package that only wanted a
 * background timer to **invent a hook merely to be called**, and it forbade a
 * storage provider from registering the hook that keeps its own derived data in
 * step. Neither restriction bought anything — the two halves run in different
 * places for reasons that have nothing to do with each other, and a list says so
 * where an enum could only ever pick one.
 *
 * Every field is declared rather than discovered, which is §13.2's rule and not a
 * convenience: `silo plugin info` has to show an operator what a package will
 * attach to *before* any of its code runs, and a function the module exports but
 * the manifest does not declare is never called.
 */
export interface PluginContributions {
  /** Entry lifecycle hooks (§13.5). Delivery is a claim per hook (D34). */
  hooks: readonly HookName[];

  /** HTTP routes served under `/api/ext/{name}/*`, behind `http:route` (D36,
   *  phase 6). */
  routes: readonly PluginRoute[];

  /**
   * Whether the module exports `activate(ctx)` / `deactivate(ctx)`.
   *
   * Declared, so an operator reading the manifest can see that this package runs
   * code of its own accord rather than only in answer to something. It costs no
   * claim: `activate` reaches nothing `ctx` does not already check, and unlike a
   * hook it is told about nobody else's data — what it adds is *uncaused* work,
   * not new authority.
   */
  runtime: boolean;

  /** Storage or blob drivers, each naming its own entry module (§13.7). */
  providers: readonly PluginProvider[];
}
