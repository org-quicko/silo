import { PluginContract } from "../plugin-contract";
import type { ScaffoldOptions } from "../scaffold-options";

/**
 * The `[[plugins]]` block that turns a directory into a loaded plugin
 * (D31/§13.8).
 *
 * Printed at the end of a scaffold and embedded in the generated README,
 * rather than written into anyone's `silo.toml`. Which code an instance runs
 * is the operator's decision and the config file is the whole management
 * surface at 1.0 — a scaffolder that edited it would be making the install
 * decision on their behalf, in a file it did not create and cannot safely
 * reformat.
 *
 * `claims` is emitted as **exactly what the manifest requests**, because the
 * two are compared at load: a plugin granted less than it asked for refuses
 * the start, and a copy-pasteable block that refuses the start is worse than
 * no block at all.
 */
export class TomlSnippet {
  static render(options: ScaffoldOptions): string {
    const claims = options.claims.map((claim) => `"${claim}"`).join(", ");

    const lines = [
      `[[plugins]]`,
      `name       = "${options.name}"`,
      `claims     = [${claims}]`,
      `timeout_ms = ${PluginContract.DefaultTimeoutMs}`,
      `on_error   = "fail"`,
    ];

    if (options.withConfig) {
      // Indented under the array entry, which is presentation only — TOML
      // reads it identically flush left — but it is how §13.8 and `silo init`
      // both show a sub-table, and matching them is the point.
      lines.push(``, `  [plugins.config]`, `  collection = "posts"`);
    }

    return `${lines.join("\n")}\n`;
  }

  /** The one-line reminder that goes with the block wherever it is shown: the
   *  array is ordered, and that order *is* dispatch order. */
  static readonly OrderNote =
    "The [[plugins]] array is ordered, and that order is hook dispatch order — top to bottom.";
}
