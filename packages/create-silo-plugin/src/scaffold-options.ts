import type { HookName, PluginKind, ProviderPort } from "./plugin-contract";
import type { ScaffoldRoute } from "./plugin-routes";

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

  /**
   * Extension only, and it may be empty.
   *
   * It could not be before: `ManifestReader` refused an extension declaring no
   * hooks, so this tool required one. Since D36 the manifest asks whether
   * *anything* would ever call the package — a hook, a route, a runtime, a
   * panel — so a routes-only or panel-only plugin is a legitimate scaffold and
   * `OptionsResolver` enforces the real rule instead of the old proxy for it.
   */
  hooks: HookName[];

  /** Routes served under `/api/ext/<name>/*`, behind `http:route` (§13.18). */
  routes: ScaffoldRoute[];

  /** Whether the module exports `activate(ctx)` / `deactivate(ctx)` (D36) —
   *  what a plugin that does something of its own accord needs. */
  runtime: boolean;

  /** Whether to emit `panel.html` and declare `contributes.ui` (D41): a screen
   *  the admin renders in a sandboxed frame, which reaches this plugin's own
   *  routes and nothing else. */
  panel: boolean;

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
