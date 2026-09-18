import { TTLCache } from "@isaacs/ttlcache";
import type { SiloCacheOptions } from "./silo-cache-options.js";

interface CachedResponse {
  body: unknown;
}

/** The cache's values and pending-read tickets. */
export class ResponseCache {
  readonly #store: TTLCache<string, CachedResponse>;
  readonly #pending = new Map<string, symbol>();

  constructor(options: SiloCacheOptions) {
    this.#store = new TTLCache({
      ttl: options.ttlMilliseconds,
      ...(options.maxEntries === undefined || options.maxEntries === Infinity ? {} : { max: options.maxEntries }),
      checkAgeOnGet: true,
      updateAgeOnGet: false,
    });
  }

  get size(): number {
    return this.#store.size;
  }

  get(key: string): CachedResponse | undefined {
    const cached = this.#store.get(key);
    return cached === undefined ? undefined : { body: structuredClone(cached.body) };
  }

  set(key: string, ticket: symbol, body: unknown): void {
    if (this.#pending.get(key) !== ticket) return;
    this.#store.set(key, { body: structuredClone(body) });
  }

  start(key: string): symbol {
    const ticket = Symbol();
    this.#pending.set(key, ticket);
    return ticket;
  }

  finish(key: string, ticket: symbol): void {
    if (this.#pending.get(key) === ticket) this.#pending.delete(key);
  }

  clear(): void {
    this.#pending.clear();
    this.#store.clear();
  }
}
