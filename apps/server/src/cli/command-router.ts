import type { Config } from "../config/config";
import { ConfigLoader } from "../config/config-loader";
import { Daemon } from "../runtime/daemon";
import { CliOptions } from "./cli-options";
import type { CliInvocation } from "./cli-invocation";
import { AddCommand } from "./commands/add-command";
import { ExportCommand } from "./commands/export-command";
import { ImportCommand } from "./commands/import-command";
import { InitCommand } from "./commands/init-command";
import { KeysCommand } from "./commands/keys-command";
import { LogsCommand } from "./commands/logs-command";
import { MediaCommand } from "./commands/media-command";
import { PluginCommand } from "./commands/plugin-command";
import { SearchCommand } from "./commands/search-command";
import { ServeCommand } from "./commands/serve-command";
import { ServeDetachedCommand } from "./commands/serve-detached-command";
import { StatusCommand } from "./commands/status-command";
import { StopCommand } from "./commands/stop-command";
import { SiloRuntime } from "./runtime/silo-runtime";
import { UsageText } from "./usage-text";

/**
 * Routes a subcommand, in three tiers that differ by how much they need to
 * exist first.
 *
 * 1. {@link runBeforeConfig} — `init` writes the file the others read.
 * 2. {@link runWithoutStorage} — process management and `add`: none of these
 *    *is* the server, and asking whether one is running, or reading its log,
 *    must not create a data directory or take a handle on a database another
 *    process owns.
 * 3. {@link runAgainstData} — everything that opens storage.
 */
export class CommandRouter {
  static async dispatch(invocation: CliInvocation): Promise<void> {
    const configPath = CliOptions.configPath(invocation.values);

    if (await CommandRouter.runBeforeConfig(invocation, configPath)) return;

    const config = ConfigLoader.resolveDerivedDefaults(
      CliOptions.applyOverrides(
        await ConfigLoader.loadConfig(
          configPath,
          CliOptions.configWasExplicit(invocation.argv)
        ),
        invocation.values
      )
    );

    if (await CommandRouter.runWithoutStorage(invocation, config, configPath)) return;
    await CommandRouter.runAgainstData(invocation, config);
  }

  /**
   * `init` runs before the config is loaded: it writes the file the other
   * commands read, so an absent `--config` is the normal case rather than the
   * error `loadConfig` makes of it, and scaffolding a config must not create a
   * data dir as a side effect.
   */
  private static async runBeforeConfig(
    invocation: CliInvocation,
    configPath: string
  ): Promise<boolean> {
    if (invocation.command !== "init") return false;

    await CommandRouter.reportingFailure(async () => {
      await InitCommand.run(configPath, !!invocation.values.force);
    });
    process.exit(0);
  }

  private static async runWithoutStorage(
    invocation: CliInvocation,
    config: Config,
    configPath: string
  ): Promise<boolean> {
    const { command, values, positionals } = invocation;

    // `add` belongs here (D32): it writes a directory under the data dir and
    // appends to the config file, and opens neither storage nor a plugin.
    // Installing against a data dir a live server owns is therefore safe — §13
    // loads plugins once at startup and nothing reloads them.
    //
    // `silo plugin add` is accepted as well as `silo add`, because §12.8 named
    // it that way for years before it existed and an operator who remembers the
    // roadmap should not get "unknown command".
    const isAdd = command === "add" || (command === "plugin" && positionals[1] === "add");

    if (
      !isAdd &&
      !["stop", "status", "logs"].includes(command) &&
      !(command === "serve" && values.detach)
    ) {
      return false;
    }

    await CommandRouter.reportingFailure(async () => {
      if (isAdd) {
        const spec = positionals[command === "add" ? 1 : 2];
        return AddCommand.run(config, configPath, spec, values as any);
      }
      if (command === "serve") return ServeDetachedCommand.run(config, invocation.version);
      if (command === "stop") {
        return StopCommand.run(config, CliOptions.seconds(values.timeout, Daemon.StopTimeoutMs));
      }
      if (command === "status") return StatusCommand.run(config);
      return LogsCommand.run(config, CliOptions.count(values.lines, 50), !!values.follow);
    });
    process.exit(0);
  }

  private static async runAgainstData(
    invocation: CliInvocation,
    config: Config
  ): Promise<void> {
    let runtime: SiloRuntime;
    try {
      runtime = await SiloRuntime.open(config, invocation.command);
    } catch (error: any) {
      console.error(`silo: ${error.message}`);
      process.exit(1);
    }

    try {
      await CommandRouter.runCommand(invocation, config, runtime);
    } catch (error: any) {
      console.error(`silo: ${error.message}`);
      await runtime.close();
      process.exit(1);
    }
  }

  private static async runCommand(
    invocation: CliInvocation,
    config: Config,
    runtime: SiloRuntime
  ): Promise<void> {
    const { command, values, positionals, version } = invocation;
    const { service, store } = runtime;

    switch (command) {
      case "serve":
        await ServeCommand.run(service, config, version, store, runtime.logger);
        await runtime.plugins.stop();
        return;
      case "plugin":
        return PluginCommand.run(config, service, positionals, values);
      case "keys":
        return KeysCommand.run(service, store, positionals, values);
      case "export":
        return ExportCommand.run(service, store, values, version);
      case "import":
        return ImportCommand.run(service, store, positionals, values);
      case "media":
        return MediaCommand.run(service, positionals);
      case "search":
        return SearchCommand.run(service, positionals, values);
      default:
        console.error(`silo: unknown command "${command}"`);
        UsageText.print();
        process.exit(2);
    }
  }

  /** Every pre-storage command reports the same way: one line, exit 1. */
  private static async reportingFailure(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error: any) {
      console.error(`silo: ${error.message}`);
      process.exit(1);
    }
  }
}
