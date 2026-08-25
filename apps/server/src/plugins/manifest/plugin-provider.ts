import type { ProviderPort } from "./provider-port";

/**
 * One provider a package contributes (D36).
 *
 * `entry` is what makes a provider a *contribution* rather than a whole package's
 * identity. Providers are constructed **before storage exists** and run
 * in-process, while hooks and routes run in a `Worker` — so a package doing both
 * cannot serve them from one module: the extension half is free to import things
 * that only make sense once there is a store, and pulling that into the host
 * before there is one is how a provider load fails in a way nobody can read.
 * Naming its own entry is also what lets one package register two drivers.
 */
export interface PluginProvider {
  port: ProviderPort;

  /** The name `[storage] driver` (or the blob equivalent) selects it by.
   *  Reserved names are refused — see `ProviderRegistry`. */
  driver: string;

  /** The module to import, relative to the package directory. Its default export
   *  is `{ create(config, hostConfig) }`. */
  entry: string;
}
