import { CachingTransport } from "../transport/caching-transport.js";
import type { FetchTransport } from "../transport/fetch-transport.js";
import type { Transport } from "../transport/transport.js";
import { ResponseCache } from "./response-cache.js";
import type { SiloCacheOptions } from "./silo-cache-options.js";

/** An optional, in-memory cache shared by one or more `Silo` instances. */
export class SiloCache {
  readonly #responseCache: ResponseCache | undefined;

  constructor(options?: SiloCacheOptions) {
    if (options !== undefined) SiloCache.validate(options);
    this.#responseCache = options === undefined ? undefined : new ResponseCache(options);
  }

  get enabled(): boolean {
    return this.#responseCache !== undefined;
  }

  get size(): number {
    return this.#responseCache?.size ?? 0;
  }

  /** Clears responses and prevents pending reads from storing their results. */
  clear(): void {
    this.#responseCache?.clear();
  }

  /** @internal */
  wrap(fetchTransport: FetchTransport): Transport {
    return this.#responseCache ? new CachingTransport(fetchTransport, this.#responseCache) : fetchTransport;
  }

  private static validate(options: SiloCacheOptions): void {
    if (!Number.isSafeInteger(options.ttlMilliseconds) || options.ttlMilliseconds <= 0) {
      throw new TypeError("SiloOptions.cache.ttlMilliseconds must be a positive finite safe integer");
    }
    if (
      options.maxEntries !== undefined
      && options.maxEntries !== Infinity
      && (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0)
    ) {
      throw new TypeError("SiloOptions.cache.maxEntries must be a positive safe integer or Infinity");
    }
  }
}
