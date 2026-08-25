/**
 * What a plugin route answered (D36, phase 6).
 *
 * Normalised **inside the worker** rather than here, so the ergonomic forms a
 * plugin may return — a bare object, a string, nothing at all — have exactly one
 * interpreter and the host only ever sees this shape. That keeps the host from
 * having to guess at a value that already crossed a clone boundary.
 */
export interface PluginServeResponse {
  status: number;
  headers: Record<string, string>;
  /** Text, or `null` for a response with no body — a 204, or a handler that
   *  returned nothing. */
  body: string | null;
}
