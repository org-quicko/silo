/** Per-client caching. Both ttl and maxSize must resolve from the method or these options. */
export interface CacheOptions {
  enabled: boolean;
  /** Lifetime after insertion, in milliseconds. Use a finite positive value. */
  ttl?: number;
  /** Maximum responses per resolved policy. Infinity removes the entry-count limit. */
  maxSize?: number;
}
