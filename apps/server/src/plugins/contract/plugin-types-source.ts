import { PluginApiContract } from "./plugin-api-contract";
import type { PluginApiOperation } from "./plugin-api-operation";

/**
 * The declaration half of the generated client (D35).
 *
 * Unlike `PluginClientSource` this one is emitted into a **file**, because
 * `tsc` reads files and a plugin author's editor reads `tsc`. So the copy in
 * `silo-api-types.d.ts` is checked in between markers and pinned by a drift
 * test — the same arrangement, and for the same reason, as the byte-for-byte
 * check that keeps `create-silo-plugin`'s shipped copy honest.
 *
 * Markers rather than a whole generated file: everything else in those
 * declarations — the hook payloads, `defineSiloPlugin`, the two throwable
 * errors — is prose about design, and moving it into a generator would trade
 * something a human should read for something a program can.
 */
export class PluginTypesSource {
  static readonly Begin = "    // <generated from PluginApiContract>";
  static readonly End = "    // </generated from PluginApiContract>";

  /** The `SiloContext` members, indented to sit inside its interface body. */
  static block(): string {
    const lines: string[] = [];

    for (const group of PluginApiContract.groups()) {
      lines.push(`    ${group}: {`);
      for (const operation of PluginApiContract.group(group)) {
        lines.push(`      /** ${operation.summary} */`);
        lines.push(`      ${PluginTypesSource.member(operation)}`);
      }
      lines.push("    };");
    }

    return lines.join("\n");
  }

  /** The block with its markers, which is what the file carries. */
  static marked(): string {
    return [PluginTypesSource.Begin, PluginTypesSource.block(), PluginTypesSource.End].join("\n");
  }

  private static member(operation: PluginApiOperation): string {
    const parameters = operation.parameters
      .map((parameter) => `${parameter.name}${parameter.optional ? "?" : ""}: ${parameter.type}`)
      .join(", ");

    return `${PluginApiContract.methodOf(operation)}(${parameters}): Promise<${operation.returns}>;`;
  }
}
