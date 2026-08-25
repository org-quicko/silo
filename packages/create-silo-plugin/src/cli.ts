import path from "node:path";
import { Arguments } from "./arguments";
import { Help } from "./help";
import { OptionsResolver } from "./options-resolver";
import { Scaffold } from "./scaffold";
import { SiloRange } from "./silo-range";
import { Style } from "./style";
import { TomlSnippet } from "./render/toml-snippet";
import { PluginName } from "./plugin-name";
import type { ScaffoldOptions } from "./scaffold-options";

/**
 * `create-silo-plugin`, end to end.
 *
 * Returns an exit code rather than calling `process.exit`, so the whole thing
 * is callable from a test without taking the test runner down with it — the
 * same reason silo's own commands hand control back to `Cli` instead of
 * exiting where they finish.
 *
 * The closing report is not decoration. A scaffolded directory is inert until
 * it is *placed* under the data dir and *named* in `silo.toml`, and neither of
 * those is something this tool does — so the three steps that turn files into
 * a loaded plugin are printed, in order, with the TOML block ready to paste.
 */
export class Cli {
  static async run(argv: readonly string[]): Promise<number> {
    let values;
    try {
      values = Arguments.parse(argv);
    } catch (err: any) {
      process.stderr.write(`${Style.red("error")} ${err.message}\n`);
      return 1;
    }

    if (values.help) {
      process.stdout.write(Help.text());
      return 0;
    }
    if (values.version) {
      process.stdout.write(`create-silo-plugin ${SiloRange.toolVersion}\n`);
      return 0;
    }

    try {
      const options = await OptionsResolver.resolve(values);
      const written = await Scaffold.create(options);
      Cli.report(options, written);
      return 0;
    } catch (err: any) {
      process.stderr.write(`\n${Style.red("error")} ${err?.message ?? err}\n`);
      return 1;
    }
  }

  /** One line each, and only for the files whose presence is not
   *  self-explanatory. `.gitignore` does not need explaining. */
  private static readonly Notes: Record<string, string> = {
    "package.json": "the manifest — silo reads package.json#silo without running anything",
    "index.ts": "your plugin; no build step, no dependencies",
    "silo-api.d.ts": "types for the silo:api virtual module (runtime contribution: none)",
    "README.md": "where this directory goes, and the [[plugins]] block",
  };

  private static report(options: ScaffoldOptions, written: readonly string[]): void {
    const out = (line = "") => process.stdout.write(`${line}\n`);
    const dir = path.relative(process.cwd(), path.resolve(options.directory)) || ".";

    out();
    out(`${Style.green("created")} ${Style.bold(dir)}`);
    out();
    for (const file of written) {
      const note = Cli.Notes[file];
      out(`  ${file.padEnd(16)}${note ? Style.dim(note) : ""}`);
    }

    out();
    for (const [label, value] of Cli.summary(options)) {
      out(`  ${Style.dim(label.padEnd(10))}${value}`);
    }

    out();
    out(Style.bold("Next"));
    out(`  1. place it where silo looks for plugins`);
    out(Style.dim(`       cp -r ${dir} <data dir>/plugins/${PluginName.installPath(options.name)}`));
    out(`  2. name it in silo.toml`);
    for (const line of TomlSnippet.render(options).trimEnd().split("\n")) {
      out(Style.dim(`       ${line}`));
    }
    out(`  3. check it loads`);
    out(Style.dim(`       silo plugin doctor`));
    out();
    out(Style.dim(TomlSnippet.OrderNote));
    out();
  }

  private static summary(options: ScaffoldOptions): [string, string][] {
    const rows: [string, string][] = [
      ["name", options.name],
      ["kind", options.kind],
      // Shown because it is the whole compatibility gate and the one value
      // nothing prompted for: an author who is targeting a different build
      // needs to see what was assumed, not discover it at `doctor`.
      ["requires", `silo ${options.siloRange}`],
    ];

    if (options.kind === "extension") {
      rows.push(["hooks", options.hooks.join(", ")]);
    } else {
      rows.push(["provides", `${options.port} driver "${options.driver}"`]);
    }
    rows.push(["claims", options.claims.length > 0 ? options.claims.join(", ") : "(none)"]);
    return rows;
  }
}
