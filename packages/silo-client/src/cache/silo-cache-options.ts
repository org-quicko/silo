/** Bounds an opt-in in-memory read cache. */
export interface SiloCacheOptions {
  /** Positive finite safe integer in milliseconds, counted from storage. */
  ttlMilliseconds: number;
  /** Positive safe integer or Infinity. Omit for no count limit. */
  maxEntries?: number;
}
