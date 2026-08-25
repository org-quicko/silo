import { Claims } from "@silo/shared/claims";
import type { Config } from "../../config/config";
import { PluginBlockWriter } from "../../config/plugin-block-writer";
import type { PluginConfig } from "../../config/plugin-config";
import { PluginInstaller, PluginRegistry } from "../../plugins";
import type { InstallResult } from "../../plugins";
import { Confirm } from "../confirm";

export interface AddOptions {
  /** Grant these instead of what the manifest requests. */
  claims?: string;
  /** Do not ask before granting claims. */
  yes?: boolean;
  force?: boolean;
  ref?: string;
  integrity?: string;
  registry?: string;
  "timeout-ms"?: string;
  "on-error"?: string;
  /** Install the files and print the block, but leave `silo.toml` alone. */
  "no-register"?: boolean;
}

/**
 * `silo add <spec>` — install a plugin and list it (D32).
 *
 * Two steps that are deliberately separable, because they are two different
 * decisions. Installing puts verified bytes in `<data dir>/plugins/`, which is
 * inert: nothing loads a directory silo.toml does not name. **Listing** it is
 * what makes it run, and what grants it claims — so that half asks first, can
 * be skipped with `--no-register`, and prints the block it would have written
 * whenever it does not write it. The operator is never left without the thing
 * they need to finish by hand.
 *
 * Which is also why `add` runs before storage is opened, alongside `init`,
 * `status` and `logs`: it writes a directory and a config file and never opens
 * the database, so it is safe to run against a data dir a live server owns.
 * What it changes takes effect on that server's next restart, not sooner —
 * §13 loads plugins at startup and nothing reloads them.
 */
export class AddCommand {
  static async run(
    config: Config,
    configPath: string,
    spec: string | undefined,
    options: AddOptions
  ): Promise<void> {
    if (!spec) {
      console.error(`usage: silo add <name|path|url> [--claims a,b] [--yes] [--force]`);
      process.exit(1);
    }

    const result = await PluginInstaller.install({
      pluginsDir: PluginRegistry.directory(config),
      spec,
      ref: options.ref,
      integrity: options.integrity,
      registry: options.registry,
      force: options.force,
    });

    AddCommand.report(result);
    await AddCommand.register(configPath, result, options);
  }

  private static report(result: InstallResult): void {
    const { manifest } = result;
    const attaches =
      manifest.kind === "provider"
        ? `provides ${manifest.provider!.port} driver "${manifest.provider!.driver}"`
        : `hooks ${manifest.hooks.join(", ")}`;

    console.log(`${result.replaced ? "replaced" : "installed"} ${result.name}`);
    console.log(`  from      : ${result.source.kind} (${result.resolved})`);
    console.log(`  directory : ${result.dir}`);
    console.log(`  kind      : ${manifest.kind}, ${attaches}`);
    if (result.integrity) console.log(`  integrity : ${result.integrity}`);
    for (const warning of result.warnings) console.log(`  note      : ${warning}`);
  }

  /**
   * The half that makes it run.
   *
   * Every path that declines to write ends by printing the block, so "silo did
   * not do this for you" and "you now cannot do it" stay different outcomes.
   */
  private static async register(
    configPath: string,
    result: InstallResult,
    options: AddOptions
  ): Promise<void> {
    const pluginBlock = AddCommand.entry(result, options);
    const block = PluginBlockWriter.render(pluginBlock);

    if (options["no-register"]) return AddCommand.printBlock(block, `not listed, as asked.`);

    if (!(await PluginBlockWriter.exists(configPath))) {
      return AddCommand.printBlock(
        block,
        `no ${configPath} to add it to — run "silo init" first, then add this block:`
      );
    }
    if (await PluginBlockWriter.names(configPath, result.name)) {
      console.log(`\n${configPath} already lists ${result.name} — left it alone.`);
      console.log(`Its existing entry decides the claims and dispatch order.`);
      return;
    }
    if (!(await AddCommand.granted(pluginBlock, result, !!options.yes))) {
      return AddCommand.printBlock(block, `not listed. To run it, add this block to ${configPath}:`);
    }

    await PluginBlockWriter.append(configPath, block);
    console.log(`\nlisted in ${configPath}. It dispatches last, after the plugins above it.`);
    console.log(`Restart the server to load it: plugins are read at startup.`);
  }

  /**
   * Consent for the claims, which is the only thing here worth stopping for.
   *
   * The manifest *requesting* a claim is not the operator granting it — that
   * distinction is the whole of §13.6 — so the request is shown and confirmed
   * rather than copied through. A plugin asking for nothing is not a security
   * decision and is not treated as one.
   */
  private static async granted(
    pluginBlock: PluginConfig,
    result: InstallResult,
    assumeYes: boolean
  ): Promise<boolean> {
    const missing = result.manifest.claims.filter((claim) => !Claims.has(pluginBlock.claims, claim as any));
    if (missing.length > 0) {
      console.log(`\n${result.name} requests ${missing.join(", ")}, which --claims does not cover.`);
      console.log(`serve would refuse to start with that grant, so it was not written.`);
      return false;
    }
    if (pluginBlock.claims.length === 0) return true;

    // Printed even under --yes: the grant is the thing worth having in the
    // scrollback of the run that made it, and a CI log is the only record
    // anyone will ever have of what a machine agreed to.
    console.log(`\n${result.name} would be granted:`);
    for (const claim of pluginBlock.claims) console.log(`  ${claim}`);
    console.log(`A plugin acts with these the way an API key holding them would.`);

    if (assumeYes) return true;
    if (!Confirm.interactive()) {
      console.log(`\nRefusing to grant claims without a terminal to confirm at. Pass --yes.`);
      return false;
    }
    return await Confirm.ask(`Grant them and list the plugin in the config?`);
  }

  /** What the `[[plugins]]` entry will say: the manifest's request unless
   *  `--claims` overrides it, and silo's defaults for everything else. */
  private static entry(result: InstallResult, options: AddOptions): PluginConfig {
    const requested =
      typeof options.claims === "string"
        ? options.claims.split(",").map((claim) => claim.trim()).filter((claim) => claim.length > 0)
        : result.manifest.claims;

    const pluginBlock = PluginBlockWriter.defaults(result.name, requested);

    const timeout = Number(options["timeout-ms"]);
    if (Number.isFinite(timeout) && timeout > 0) pluginBlock.timeout_ms = timeout;
    if (options["on-error"] === "skip" || options["on-error"] === "fail") {
      pluginBlock.on_error = options["on-error"];
    }
    return pluginBlock;
  }

  private static printBlock(block: string, why: string): void {
    console.log(`\n${why}`);
    console.log(`\n${block}`);
  }
}
