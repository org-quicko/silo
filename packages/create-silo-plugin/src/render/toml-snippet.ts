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
 * `claims` is emitted as **exactly what the manifest requests**, including the
 * `hooks:` claim each declared hook needs (D34). A grant may be narrower than
 * this — the scopes are `*&#47;*&#47;*` and an operator will often want one project —
 * but it may not be *absent*: hook delivery is granted, never inferred, so a
 * block without them scaffolds a plugin that loads and never fires. A
 * copy-pasteable block that does nothing is worse than no block at all.
 */
export class TomlSnippet {
  /**
   * The claim list the block grants, as values.
   *
   * Its own method so the end-to-end test can load a plugin with *exactly* what
   * the printed block says, rather than restating it — the thing being asserted
   * is that pasting the block works, and a test that computed the list its own
   * way would pass while the printed one was wrong.
   */
  static requestedClaims(options: ScaffoldOptions): string[] {
    return [
      ...options.claims,
      ...options.hooks.map((hook) => `hooks:*/*/*:${hook}`),
      // `http:route` is derived from declared routes exactly as a `hooks:` claim
      // is derived from a declared hook (D36/§13.19), and it is not optional: a
      // plugin whose every route answers 403 is running, healthy, and not doing
      // the thing it was installed for, which the start refuses rather than
      // leaving to a caller to discover.
      ...(options.routes.length > 0 ? ["http:route"] : []),
    ];
  }

  static render(options: ScaffoldOptions): string {
    const claims = TomlSnippet.requestedClaims(options)
      .map((claim) => `"${claim}"`)
      .join(", ");

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
