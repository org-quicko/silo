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
}
