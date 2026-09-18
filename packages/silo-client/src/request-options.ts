import type { CacheMode } from "./cache/cache-mode.js";

/**
 * The one cancellation convention on every call: the last parameter of
 * every method in the client. A per-call value wins over the client's own
 * default timeout.
 */
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMilliseconds?: number;
  /** `bypass` skips lookup and storage; `refresh` fetches and stores. Ignored on writes and disabled caches. */
  cache?: CacheMode;
}
