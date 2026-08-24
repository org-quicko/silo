import type { ScaffoldOptions } from "../scaffold-options";

/**
 * The generated `package.json`, whose `silo` block **is** the manifest
 * (D31/§13.2).
 *
 * Built as an object and serialised, not assembled from template strings: the
 * one file here that silo parses rather than a human reads is the one file
 * that must not be able to come out as invalid JSON, and key order — the only
 * thing `JSON.stringify` costs — is insertion order, which is spelled out
 * below anyway.
 *
 * `main` points at `index.ts` on purpose. A compiled silo carries the Bun
 * transpiler, so a plugin needs no build step (§13.10), and pointing at a
 * `dist/` that does not exist is the first thing a scaffolded plugin could get
 * wrong.
 */
export class Manifest {
  static render(options: ScaffoldOptions): string {
    const silo: Record<string, unknown> = {
      silo: options.siloRange,
      kind: options.kind,
    };

    // Extensions only. `ManifestReader` refuses an extension with no hooks —
    // nothing would ever call it — and a provider carrying an empty `hooks`
    // array is a key an operator has to read and then discard.
    if (options.kind === "extension") silo.hooks = options.hooks;
    silo.claims = options.claims;
    if (options.withConfig) silo.config = Manifest.configSchema();
    if (options.kind === "provider") {
      silo.provider = { port: options.port, driver: options.driver };
    }

    return `${JSON.stringify(
      {
        name: options.name,
        version: "0.1.0",
        description: Manifest.description(options),
        // ESM, because the host imports the entry module with `import()`.
        type: "module",
        main: "index.ts",
        silo,
      },
      null,
      2
    )}\n`;
  }

  /**
   * A one-key schema, and the reason it is exactly one key: every hook stub
   * this tool emits opens by asking "is this the collection I care about?",
   * so the scaffold's `config` is the answer to that question. A schema that
   * demonstrated five keyword types would be a better JSON Schema tutorial and
   * a worse starting point — nothing in the generated code would read it.
   */
  private static configSchema(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description: "The collection this plugin acts on.",
        },
      },
      required: ["collection"],
      // Closed, so a typo in `silo.toml` refuses the start instead of being
      // silently ignored — the same instinct the rest of silo's config has.
      additionalProperties: false,
    };
  }

  private static description(options: ScaffoldOptions): string {
    if (options.kind === "provider") {
      return `A silo ${options.port} provider registering the "${options.driver}" driver`;
    }
    return `A silo extension plugin (${options.hooks.join(", ")})`;
  }
}
