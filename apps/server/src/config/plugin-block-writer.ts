import fs from "fs/promises";
import { TOML } from "bun";
import { ConfigLoader } from "./config-loader";
import type { PluginConfig } from "./plugin-config";

/**
 * Adding a `[[plugins]]` entry to an existing `silo.toml` (D32/§13.8).
 *
 * **Appended as text, never re-serialised.** A round trip through a TOML
 * writer would destroy every comment in a file that `silo init` writes as
 * mostly comments, on purpose.
 *
 * Appending is also *correct* for this array specifically: its order is hook
 * dispatch order, so a newly added plugin dispatches last — the only
 * defensible default. Reading is still done with the real parser; detecting a
 * duplicate by regex over the file text works until someone writes their
 * config differently.
 */
export class PluginBlockWriter {
  /** Whether `silo.toml` already names this plugin. A second entry for the
   *  same name is not a no-op — `HookBus` would dispatch to it twice — so this
   *  is a refusal, not a warning. */
  static async names(configPath: string, name: string): Promise<boolean> {
    let text: string;
    try {
      text = await fs.readFile(configPath, "utf8");
    } catch {
      return false;
    }

    const parsed = TOML.parse(text) as any;
    const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : [];
    return plugins.some((entry: any) => entry?.name === name);
  }

  static async exists(configPath: string): Promise<boolean> {
    try {
      return (await fs.stat(configPath)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Append the block, leaving everything already in the file alone.
   *
   * The read-then-append is not atomic and deliberately not made so: this runs
   * from a CLI a person is watching, against a file that same person owns, and
   * a lock protocol over `silo.toml` would be machinery for a race that does
   * not happen. `serve` refuses to start twice over one data dir for the cases
   * where concurrency is real (D25).
   */
  static async append(configPath: string, block: string): Promise<void> {
    const existing = await fs.readFile(configPath, "utf8");
    const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    await fs.writeFile(configPath, `${existing}${separator}${block}`, "utf8");
  }

  /**
   * The block itself.
   *
   * `claims` is written as **exactly what the manifest requests**, because the
   * two are compared at load and a plugin granted less than it asked for
   * refuses the start (`PluginLoader.assertGranted`). Writing a block that
   * would refuse the start is worse than writing none, which is the same
   * reasoning `create-silo-plugin`'s printed snippet follows — and the reason
   * `silo add` shows the claims and asks before writing them rather than
   * treating the manifest's request as consent.
   */
  static render(config: PluginConfig, note?: string): string {
    const claims = config.claims.map((claim) => JSON.stringify(claim)).join(", ");

    const lines = [
      ...(note ? [`# ${note}`] : []),
      `[[plugins]]`,
      `name       = ${JSON.stringify(config.name)}`,
      `claims     = [${claims}]`,
      `timeout_ms = ${config.timeout_ms}`,
      `on_error   = ${JSON.stringify(config.on_error)}`,
    ];

    // Only when there is something to put in it: an empty `[plugins.config]`
    // table is noise, and a plugin whose schema requires a key would fail
    // validation on it either way — better that it fails naming the key than
    // that the file implies it was configured.
    if (Object.keys(config.config).length > 0) {
      lines.push(``, `  [plugins.config]`);
      for (const [key, value] of Object.entries(config.config)) {
        lines.push(`  ${key} = ${JSON.stringify(value)}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /** A `PluginConfig` holding what silo would default to for a freshly
   *  installed plugin, so the block and the loader agree without either side
   *  restating the defaults. */
  static defaults(name: string, claims: readonly string[]): PluginConfig {
    return {
      name,
      claims: [...claims],
      timeout_ms: ConfigLoader.DefaultPluginTimeoutMs,
      on_error: "fail",
      config: {},
    };
  }
}
