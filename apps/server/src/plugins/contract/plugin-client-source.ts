import { PluginApiContract } from "./plugin-api-contract";
import type { PluginApiOperation } from "./plugin-api-operation";

/**
 * The worker half of the generated client, emitted from `PluginApiContract`
 * (D35).
 *
 * Generated **at start rather than checked in**, which removes the possibility
 * of drift instead of testing for it: there is no second copy of this to fall
 * behind. Only the `.d.ts` has to exist as a file, because `tsc` cannot read a
 * contract, and that one is pinned by a drift test.
 *
 * It emits an object literal and nothing else. The runtime half — the request
 * helper, the query encoder, the error mapping — is hand-written in
 * `WorkerSource`, because none of it varies per operation and generating
 * invariant code is how a generator becomes hard to read for no gain.
 */
export class PluginClientSource {
  /** `const buildApi = (call) => ({ ... });`, ready to splice into the
   *  bootstrap. */
  static lines(): string[] {
    const lines: string[] = ["const buildApi = (call) => ({"];

    for (const group of PluginApiContract.groups()) {
      lines.push(`  ${group}: {`);
      for (const operation of PluginApiContract.group(group)) {
        lines.push(`    // ${operation.summary}`);
        lines.push(`    ${PluginClientSource.method(operation)}`);
      }
      lines.push("  },");
    }

    lines.push("});");
    return lines;
  }

  private static method(operation: PluginApiOperation): string {
    const args = operation.parameters.map((parameter) => parameter.name).join(", ");
    const options = PluginClientSource.options(operation);
    const name = PluginApiContract.methodOf(operation);

    return `${name}: (${args}) => call("${operation.method}", ${PluginClientSource.path(operation)}${options}),`;
  }

  /**
   * The path as a JavaScript expression.
   *
   * Every interpolated segment goes through `enc`, so a collection or an id
   * carrying a slash cannot reach a route it was not addressed to. That the
   * server would refuse it anyway is not the point: a client that builds a
   * different request than the one it was asked to is wrong on its own terms.
   */
  private static path(operation: PluginApiOperation): string {
    const scope = operation.parameters.find((parameter) => parameter.kind === "scope");
    const fragments: string[] = [];
    let literal = "";

    for (const piece of operation.path.split(/(\{[a-z]+\})/)) {
      if (!piece) continue;
      if (!piece.startsWith("{")) {
        literal += piece;
        continue;
      }

      if (literal) fragments.push(JSON.stringify(literal));
      literal = "";

      const placeholder = piece.slice(1, -1);
      const source =
        scope && (placeholder === "project" || placeholder === "env")
          ? `${scope.name}.${placeholder}`
          : placeholder;
      fragments.push(`enc(${source})`);
    }
    if (literal) fragments.push(JSON.stringify(literal));

    return fragments.join(" + ");
  }

  /** The trailing options argument, or nothing when the call needs none. */
  private static options(operation: PluginApiOperation): string {
    const entries = operation.parameters
      .filter((parameter) => parameter.kind === "query" || parameter.kind === "body" || parameter.kind === "rev")
      .map((parameter) => `${parameter.kind}: ${parameter.name}`);

    return entries.length === 0 ? "" : `, { ${entries.join(", ")} }`;
  }
}
