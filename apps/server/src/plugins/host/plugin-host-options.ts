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
  timeoutMs: number;
  rpc: PluginRpc;
}
