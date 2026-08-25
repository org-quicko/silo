import { HookNames } from "../../core/hooks";
import type { HookName } from "../../core/hooks";
import { ManifestRoutesReader } from "./manifest-routes-reader";
import type { PluginContributions } from "./plugin-contributions";
import { PluginContributionUtils } from "./plugin-contribution-utils";
import type { PluginProvider } from "./plugin-provider";
import type { ProviderPort } from "./provider-port";

/**
 * Validates `silo.contributes` (D36).
 *
 * The one check worth reading twice is the last: a package that contributes
 * *nothing* refuses the start. That question used to be "does it declare a hook",
 * which is exactly what D36 objects to in `kind` — it made a package wanting to
 * serve a route, or run a timer, invent a hook merely to be loaded. Now it asks
 * whether anything at all would ever call it, which is the question that was
 * always meant.
 */
export class ManifestContributionsReader {
  private static readonly Ports: readonly ProviderPort[] = ["storage", "blob"];

  static read(name: string, raw: unknown): PluginContributions {
    if (raw === undefined || raw === null) {
      throw new Error(
        `plugin "${name}": package.json needs a "silo.contributes" block saying what it ` +
          `contributes — any of "hooks", "routes", "runtime" and "providers" (D36).`
      );
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`plugin "${name}": "silo.contributes" must be an object.`);
    }

    const block = raw as Record<string, unknown>;
    const contributes: PluginContributions = {
      hooks: ManifestContributionsReader.hooks(name, block.hooks),
      routes: ManifestRoutesReader.read(name, block.routes),
      runtime: ManifestContributionsReader.runtime(name, block.runtime),
      providers: ManifestContributionsReader.providers(name, block.providers),
    };

    if (PluginContributionUtils.declaresNothing(contributes)) {
      throw new Error(
        `plugin "${name}": "silo.contributes" declares nothing, so nothing would ever call ` +
          `it. Declare at least one hook (${HookNames.All.join(", ")}), one route, ` +
          `"runtime": true, or a provider.`
      );
    }
    return contributes;
  }

  private static hooks(name: string, raw: unknown): HookName[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new Error(`plugin "${name}": "silo.contributes.hooks" must be an array.`);
    }
    for (const hook of raw) {
      if (!HookNames.isHookName(hook)) {
        throw new Error(
          `plugin "${name}": unknown hook ${JSON.stringify(hook)}. ` +
            `Known hooks: ${HookNames.All.join(", ")}.`
        );
      }
    }
    return raw as HookName[];
  }

  /** A boolean and not a shape, because there is nothing to configure: the module
   *  either exports `activate`/`deactivate` or the start refuses. */
  private static runtime(name: string, raw: unknown): boolean {
    if (raw === undefined) return false;
    if (typeof raw !== "boolean") {
      throw new Error(
        `plugin "${name}": "silo.contributes.runtime" must be true or false; got ` +
          `${JSON.stringify(raw)}.`
      );
    }
    return raw;
  }

  /**
   * Providers, each naming its own entry module.
   *
   * `entry` is required rather than defaulted to the package's `main`, and that is
   * the load-order argument in §13.7 made into a validation rule: a provider is
   * imported into the **host** process before storage exists, while the rest of
   * the package runs in a worker afterwards. Sharing one module means the host
   * imports the extension half too, at the one moment when there is no store for
   * it to reach.
   */
  private static providers(name: string, raw: unknown): PluginProvider[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new Error(`plugin "${name}": "silo.contributes.providers" must be an array.`);
    }

    const providers: PluginProvider[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `plugin "${name}": every entry in "silo.contributes.providers" must be an object.`
        );
      }
      if (!ManifestContributionsReader.Ports.includes(entry.port)) {
        throw new Error(
          `plugin "${name}": provider "port" must be one of ` +
            `${ManifestContributionsReader.Ports.join(", ")}; got ${JSON.stringify(entry.port)}.`
        );
      }
      if (typeof entry.driver !== "string" || entry.driver.length === 0) {
        throw new Error(`plugin "${name}": provider "driver" must be a non-empty string.`);
      }
      if (typeof entry.entry !== "string" || entry.entry.length === 0) {
        throw new Error(
          `plugin "${name}": provider "${entry.port}/${entry.driver}" needs an "entry" naming ` +
            `the module to import. A provider loads before storage exists, so it cannot share ` +
            `the module the worker half runs from.`
        );
      }

      const key = `${entry.port}/${entry.driver}`;
      if (seen.has(key)) {
        throw new Error(`plugin "${name}": provider "${key}" is declared more than once.`);
      }
      seen.add(key);
      providers.push({ port: entry.port, driver: entry.driver, entry: entry.entry });
    }
    return providers;
  }
}
