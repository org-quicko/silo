import type { HookName } from "../../core/hooks";
import type { PluginRpc } from "./plugin-rpc";

/** Everything a host needs to run one plugin. Shared by both host adapters, so
 *  it is its own artifact rather than either one's options shape. */
export interface PluginHostOptions {
  name: string;
  /** Absolute path to the module to import. */
  entry: string;
  /** The operator's `[plugins.config]`, already validated against the
   *  manifest's JSON Schema. */
  config: Record<string, unknown>;
  declared: readonly HookName[];
  /** The keys of the routes the manifest declares — `"GET /status"` (D36, phase
   *  6). Checked against the module's exports at start for the same reason
   *  `declared` is: a route that is declared and not implemented looks, from
   *  outside, exactly like one that is working. */
  routes: readonly string[];
  timeoutMs: number;
  rpc: PluginRpc;
}
