import { PluginContract } from "./plugin-contract";
import type { HookName, PluginKind, ProviderPort } from "./plugin-contract";

/**
 * What `Arguments.parse` hands back: every answer the author supplied on the
 * command line, and nothing filled in. It stays in this file because it exists
 * only as this parser's result — a second file for it would be a type nobody
 * constructs except one function.
 *
 * Everything is optional by construction. Deciding what a missing answer
 * *becomes* is `Cli`'s job, because the answer differs by path: a prompt in a
 * terminal, a documented default under `--yes`.
 */
export interface ArgumentValues {
  name?: string;
  directory?: string;
  kind?: PluginKind;
  siloRange?: string;
  hooks?: HookName[];
  claims?: string[];
  port?: ProviderPort;
  driver?: string;
  withConfig?: boolean;
  yes: boolean;
  force: boolean;
  help: boolean;
  version: boolean;
}

/**
 * argv → `ArgumentValues`, hand-rolled.
 *
 * Node's `util.parseArgs` would do this, but it is the kind of dependency-free
 * convenience that still costs a Node-version floor and gives back errors
 * phrased for a parser rather than for someone naming a plugin. The whole
 * grammar is `--flag value` and `--flag=value`, which is thirty lines.
 *
 * Every value is validated **here**, against `PluginContract`, so an unknown
 * hook is reported with the five real ones listed while the author is still in
 * the shell — rather than at `silo plugin doctor`, after the code is written.
 */
export class Arguments {
  static parse(argv: readonly string[]): ArgumentValues {
    const values: ArgumentValues = { yes: false, force: false, help: false, version: false };

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;

      if (!arg.startsWith("-")) {
        if (values.name !== undefined) throw new Error(`unexpected argument "${arg}"`);
        values.name = arg;
        continue;
      }

      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      // `--flag=value` and `--flag value` are the same thing; `next()` is only
      // reached when the first form did not supply one.
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const next = (): string => {
        if (inline !== undefined) return inline;
        const value = argv[++i];
        if (value === undefined || value.startsWith("-")) throw new Error(`${flag} needs a value`);
        return value;
      };

      switch (flag) {
        case "-h": case "--help": values.help = true; break;
        case "-v": case "--version": values.version = true; break;
        case "-y": case "--yes": values.yes = true; break;
        case "-f": case "--force": values.force = true; break;
        case "--config": values.withConfig = true; break;
        case "--no-config": values.withConfig = false; break;
        case "-d": case "--dir": values.directory = next(); break;
        case "--silo": values.siloRange = next(); break;
        case "--driver": values.driver = next(); break;
        case "--name": values.name = next(); break;
        case "--kind": values.kind = Arguments.kind(next()); break;
        case "--port": values.port = Arguments.port(next()); break;
        case "--hooks": values.hooks = Arguments.hooks(next()); break;
        case "--claims": values.claims = Arguments.list(next()); break;
        default: throw new Error(`unknown option "${flag}" — run with --help`);
      }
    }

    return values;
  }

  private static kind(value: string): PluginKind {
    if (!PluginContract.isKind(value)) {
      throw new Error(`--kind must be ${PluginContract.Kinds.join(" or ")}, got "${value}"`);
    }
    return value;
  }

  private static port(value: string): ProviderPort {
    if (!PluginContract.isPort(value)) {
      throw new Error(`--port must be ${PluginContract.Ports.join(" or ")}, got "${value}"`);
    }
    return value;
  }

  private static hooks(value: string): HookName[] {
    const names = Arguments.list(value);
    for (const name of names) {
      if (!PluginContract.isHook(name)) {
        throw new Error(`unknown hook "${name}". silo has five: ${PluginContract.Hooks.join(", ")}`);
      }
    }
    // Deduped, order preserved: the manifest's `hooks` array is a set, and a
    // repeat there reads as a mistake in a file an operator is meant to audit.
    return [...new Set(names as HookName[])];
  }

  /** `a,b , c` → `["a", "b", "c"]`, empties dropped — so `--claims ""` is an
   *  explicit "none" rather than a claim named the empty string. */
  private static list(value: string): string[] {
    return value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  }
}
