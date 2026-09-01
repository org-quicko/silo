import { parseArgs } from "util";
import type { Config } from "../config/config";

/** One parsed command line: the flags, and the words that are not flags. */
export interface ParsedCommandLine {
  values: Record<string, unknown>;
  positionals: string[];
}

/**
 * The flag table, and the top layer of `flags > env > file > defaults`.
 *
 * `strict: false` because subcommands share one table: `--with-keys` is
 * meaningless to `logs` and rejecting it there would mean maintaining a table
 * per command for no gain.
 */
export class CliOptions {
  static readonly DefaultConfigPath = "silo.toml";

  private static readonly Flags = {
    config: { type: "string" },
    data: { type: "string" },
    "blob-path": { type: "string" },
    driver: { type: "string" },
    listen: { type: "string" },
    project: { type: "string" },
    env: { type: "string" },
    label: { type: "string" },
    preset: { type: "string" },
    collections: { type: "string" },
    claims: { type: "string" },
    force: { type: "boolean" },
    dir: { type: "string" },
    out: { type: "string" },
    "with-keys": { type: "boolean" },
    mode: { type: "string", default: "merge" },
    validate: { type: "boolean" },
    "dry-run": { type: "boolean" },
    prefer: { type: "string" },
    detach: { type: "boolean", short: "d" },
    "log-file": { type: "string" },
    "log-level": { type: "string" },
    follow: { type: "boolean", short: "f" },
    lines: { type: "string", short: "n" },
    timeout: { type: "string" },
    check: { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    ref: { type: "string" },
    integrity: { type: "string" },
    registry: { type: "string" },
    "timeout-ms": { type: "string" },
    "on-error": { type: "string" },
    "no-register": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  } as const;

  static parse(argv: string[]): ParsedCommandLine {
    const { values, positionals } = parseArgs({
      args: argv,
      options: CliOptions.Flags,
      strict: false,
      allowPositionals: true,
    });
    return { values: values as Record<string, unknown>, positionals };
  }

  /**
   * The config file the run should read: `--config`, then `SILO_CONFIG`, then
   * `silo.toml` beside the process.
   *
   * The variable is the layer a container has (D50). An image someone else
   * built has no argv to edit, and the file is no longer only read — the
   * settings APIs write it (D45/D46/D47), so an instance whose config path
   * defaults into an unwritable image directory has a Settings page that
   * cannot save. Naming a path this way is deliberately *not* the same as
   * `--config`: the file is still allowed to be missing, because on a fresh
   * volume it always is and the first save is what creates it.
   */
  static configPath(values: Record<string, unknown>): string {
    if (typeof values.config === "string") return values.config;
    return process.env.SILO_CONFIG?.trim() || CliOptions.DefaultConfigPath;
  }

  /** Whether `--config` was given, as opposed to defaulted — an explicit path
   *  that does not exist is an error, an implicit one is not. */
  static configWasExplicit(argv: string[]): boolean {
    return argv.includes("--config");
  }

  /**
   * Applies flag overrides on top of a loaded config.
   *
   * Paths derived from other settings are deliberately not filled in here:
   * `--data` moves the data dir and `ConfigLoader.resolveDerivedDefaults` works
   * out what still hangs off it afterwards.
   */
  static applyOverrides(config: Config, values: Record<string, unknown>): Config {
    if (typeof values.data === "string") config.storage.path = values.data;
    if (typeof values["blob-path"] === "string") config.blob_storage.path = values["blob-path"];
    if (typeof values.driver === "string") config.storage.driver = values.driver;
    if (typeof values.listen === "string") config.listen = values.listen;
    if (typeof values.project === "string") config.default_project = values.project;
    if (typeof values.env === "string") config.default_env = values.env;
    if (typeof values["log-file"] === "string") config.log.file = values["log-file"];
    if (typeof values["log-level"] === "string") config.log.level = values["log-level"];
    return config;
  }

  /** A `--timeout` in seconds, as milliseconds. Anything unparseable keeps the
   *  default rather than collapsing to zero, which would kill immediately. */
  static seconds(value: unknown, fallbackMs: number): number {
    const parsed = typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1000 : fallbackMs;
  }

  /** A positive integer flag, or the fallback. */
  static count(value: unknown, fallback: number): number {
    const parsed = typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
