import { PluginContract } from "./plugin-contract";
import { SiloRange } from "./silo-range";
import { Style } from "./style";

/**
 * `--help`.
 *
 * The hook list is rendered from `PluginContract` rather than typed out, so the
 * help text cannot describe a set of hooks silo does not have — the same
 * reason `silo init` renders its scaffold from `ConfigLoader.defaultConfig()`.
 */
export class Help {
  static text(): string {
    const hooks = PluginContract.Hooks.map(
      (hook) => `    ${hook.padEnd(22)} ${Style.dim(PluginContract.HookSummaries[hook])}`
    ).join("\n");

    return `${Style.bold("create-silo-plugin")} — scaffold a silo plugin

  ${Style.dim("$")} npm create silo-plugin
  ${Style.dim("$")} npm create silo-plugin silo-plugin-slugs
  ${Style.dim("$")} bunx create-silo-plugin silo-plugin-slugs --yes

Run with no arguments to be asked. Every question has a flag, and every flag
skips its question; supply all of them, or pass --yes to take the defaults, and
nothing is asked at all.

${Style.bold("Options")}
  --name <name>        npm package name; also how [[plugins]] name addresses it
  -d, --dir <path>     where to write it            ${Style.dim("(default: the name, unscoped)")}
  --kind <kind>        ${PluginContract.Kinds.join(" | ")}      ${Style.dim("(default: extension)")}
  --hooks <a,b>        extension only, comma-separated
  --claims <a,b>       what the manifest requests   ${Style.dim("(default: none)")}
  --port <port>        provider only: ${PluginContract.Ports.join(" | ")}
  --driver <name>      provider only: the driver name silo.toml selects
  --silo <range>       version range of silo        ${Style.dim(`(default: ${SiloRange.default()})`)}
  --config             emit a config schema         ${Style.dim("(extensions; --no-config to skip)")}
  -y, --yes            take every default, ask nothing
  -f, --force          write into a non-empty directory
  -h, --help           this
  -v, --version        print the version and exit

${Style.bold("Hooks")}
${hooks}

${Style.bold("What you get")}
  package.json         the manifest — silo reads package.json#silo without
                       executing anything, so it is static on purpose
  index.ts             a runnable stub per hook; no build step, no dependencies
  silo-api.d.ts        types for the silo:api virtual module, copied verbatim
                       from silo so an editor can resolve the import
  README.md            where the directory goes, and the [[plugins]] block

Plugin documentation: https://github.com/org-quicko/silo#plugins
`;
  }
}
