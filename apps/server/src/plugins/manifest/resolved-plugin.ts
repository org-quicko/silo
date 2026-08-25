import type { PluginManifest } from "./plugin-manifest";

/** A manifest plus where it was found. The loader produces these; nothing
 *  downstream re-reads the filesystem. */
export interface ResolvedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  dir: string;
  /** Absolute path to the module the host imports. */
  entry: string;
}
