/**
 * The one cancellation convention on every call: the last parameter of
 * every method in the client. A per-call value wins over the client's own
 * default timeout.
 */
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMilliseconds?: number;
}
