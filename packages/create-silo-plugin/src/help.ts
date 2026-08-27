import { PluginContract } from "./plugin-contract";
import { ScaffoldRoutes } from "./plugin-routes";
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
  --hooks <a,b>        extension only, comma-separated ${Style.dim('("" for none)')}
  --routes <a,b>       "GET /status, POST /upload+bytes:8" — see Routes below
  --runtime            export activate/deactivate   ${Style.dim("(--no-runtime to skip)")}
  --panel              ship an admin panel          ${Style.dim("(--no-panel to skip)")}
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

${Style.bold("Routes")}
  Served under /api/ext/<name>/, behind the http:route claim. One entry per
  route, "<METHOD> </path>", with :params allowed and no wildcards.

    --routes "GET /status, GET /notes/:id, DELETE /notes/:id"

  Append +bytes to a route that receives a file, and the payload arrives
  undecoded in request.bytes instead of request.body. The size is in MiB, up to
  ${String(ScaffoldRoutes.MaxBodyMib)} — declared in the manifest, so the operator sees it beside the route
  when they approve it. Without it a route gets text, up to 1 MiB.

    --routes "POST /source+bytes:64"

${Style.bold("Panel")}
  --panel ships panel.html and declares silo.contributes.ui. The admin renders
  it in a sandboxed iframe with no origin of its own, so it cannot read the
  admin's stored keys; its one capability is asking the admin to call this
  plugin's own routes with the operator's key.

${Style.bold("What you get")}
  package.json         the manifest — silo reads package.json#silo without
                       executing anything, so it is static on purpose
  index.ts             a runnable stub per hook and route; no build step, no
                       dependencies
  silo-api.d.ts        types for the silo:api virtual module, copied verbatim
                       from silo so an editor can resolve the import
  panel.html           --panel only: the screen the admin renders for it
  README.md            where the directory goes, and the [[plugins]] block

Plugin documentation: https://github.com/org-quicko/silo#plugins
`;
  }
}
