import type { CacheOptions } from "./cache/CacheOptions.js";
import type { FetchFunction } from "./transport/fetch-function.js";

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
  /** Cache collection entry reads. Omitted or disabled options leave reads uncached. */
  cache?: CacheOptions;
}
