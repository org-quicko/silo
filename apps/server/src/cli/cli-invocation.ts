/** One run of the CLI, after argv has been parsed. */
export interface CliInvocation {
  /** The raw arguments, kept because "was `--config` given?" cannot be
   *  answered from the parsed values — a default looks identical. */
  argv: string[];
  /** The subcommand: the first positional. */
  command: string;
  values: Record<string, unknown>;
  positionals: string[];
  version: string;
}
