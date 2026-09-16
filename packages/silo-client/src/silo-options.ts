import type { FetchFunction } from "./transport/fetch-function.js";
import type { SiloCache } from "./cache/silo-cache.js";
import type { SiloCacheOptions } from "./cache/silo-cache-options.js";

/**
 * Everything `new Silo(...)` accepts. Only `url` is required: a key is
 * optional because anonymous reads are legal.
 */
export interface SiloOptions {
  url: string;
  key?: string;
  timeoutMilliseconds?: number;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
  /** Enable read caching or share an existing cache. Omit to disable. */
  cache?: SiloCacheOptions | SiloCache;
}
