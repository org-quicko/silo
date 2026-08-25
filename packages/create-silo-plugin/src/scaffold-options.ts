import type { HookName, PluginKind, ProviderPort } from "./plugin-contract";

/**
 * A fully resolved answer to every question the scaffolder asks.
 *
 * Fully resolved is the point: prompts and flags are two ways of filling this
 * in, and `Scaffold` sees neither. Nothing downstream of here may be
 * `undefined` for an extension, or ask whether the author was prompted — which
 * is what keeps the interactive and `--yes` paths from being two subtly
 * different scaffolders.
 */
export interface ScaffoldOptions {
  /** The npm package name, and how `[[plugins]] name` will address it. */
  name: string;

  /** Where to write, relative to the working directory or absolute. */
  directory: string;

  kind: PluginKind;

  /** `package.json#silo.silo` — the whole compatibility gate (§13.2). */
  siloRange: string;

  /** Extension only, and never empty for one: `ManifestReader` refuses an
   *  extension that declares no hooks, since nothing would ever call it. */
  hooks: HookName[];

  /** What the manifest *requests*. The operator grants the same strings in
   *  `silo.toml`, and a plugin asking for more than it was granted refuses the
   *  start — so the generated TOML snippet grants exactly this list. */
  claims: string[];

  /** Provider only. */
  port?: ProviderPort;

  /** Provider only — the name `[storage] driver` selects it by. */
  driver?: string;

  /**
   * Whether to emit a `silo.config` JSON Schema and a matching
   * `[plugins.config]` block.
   *
   * **Extensions only**, and always `false` for a provider: the scaffolded
   * schema is the one key every hook stub reads (`collection`), and a provider
   * has no equivalent — its configuration belongs to the driver being written.
   * A plugin with no configuration should not carry a schema it has to keep
   * valid.
   */
  withConfig: boolean;

  /** Write into a directory that already has files in it. */
  force: boolean;
}
