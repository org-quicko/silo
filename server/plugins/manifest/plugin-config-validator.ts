import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { PluginManifest } from "./plugin-manifest";

/**
 * Validates `[plugins.config]` against the schema its manifest declares
 * (D31/§13.2).
 *
 * JSON Schema rather than a bespoke shape, because D3 already made that the
 * project's language for describing data and this is data. It buys two things
 * at once: a plugin's settings are checked before its code ever runs, and the
 * admin settings form can later be generated from the very same document
 * through RJSF — which is why the manifest carries `config` at 1.0 even though
 * nothing renders it yet.
 *
 * Invalid config **refuses the start**, following the precedent that an invalid
 * default project id refuses to start rather than creating a scope no route can
 * reach (D20). A plugin misconfigured into doing nothing is worse than one that
 * will not load: the instance looks healthy and quietly enforces nothing.
 */
export class PluginConfigValidator {
  private static ajv: Ajv2020 | null = null;

  static validate(manifest: PluginManifest, config: Record<string, unknown>): void {
    if (manifest.config === undefined) {
      // No schema declared. An empty table is fine; anything else is almost
      // certainly a key the operator expects to matter and that nothing reads.
      if (Object.keys(config).length > 0) {
        throw new Error(
          `plugin "${manifest.name}": [plugins.config] was given but the plugin declares no ` +
            `config schema, so none of it would be read.`
        );
      }
      return;
    }

    const ajv = PluginConfigValidator.instance();
    let validate: any;
    try {
      validate = ajv.compile(manifest.config);
    } catch (err: any) {
      throw new Error(`plugin "${manifest.name}": "silo.config" is not a valid JSON Schema: ${err.message}`);
    }

    if (!validate(config)) {
      const detail = (validate.errors ?? [])
        .map((e: any) => `${e.instancePath || "(root)"} ${e.message}`)
        .join("; ");
      throw new Error(`plugin "${manifest.name}": invalid [plugins.config]: ${detail}`);
    }
  }

  /** One compiler for every plugin. Compiling is the expensive half and there
   *  is no per-plugin state to keep apart — unlike entry validation, which
   *  caches per (scope, collection). */
  private static instance(): Ajv2020 {
    if (!PluginConfigValidator.ajv) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      PluginConfigValidator.ajv = ajv;
    }
    return PluginConfigValidator.ajv;
  }
}
