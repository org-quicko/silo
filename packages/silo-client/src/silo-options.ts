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
  /** Cache collection entry reads. Omit to disable caching. */
  cache?: {
    /** Lifetime in milliseconds, measured from insertion. Validated by TTLCache; Infinity disables expiry. */
    ttl: number;
    /** Maximum cached responses. Omit for no entry-count limit. */
    max?: number;
  };
}
