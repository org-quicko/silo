/**
 * What one `ctx.fetch` answered with (D35).
 *
 * Bytes rather than a decoded string, because the host has no business deciding
 * how a body is read: the worker wraps this in a `Response`-shaped object with
 * `text()` and `json()` on it, and methods do not survive a structured clone
 * anyway. A `Uint8Array` does.
 *
 * A non-2xx status is a **value here, not a throw**. `ctx.fetch` is the
 * primitive and reports what happened; the generated client is the layer that
 * turns a 400 into a `ValidationError` and a 403 into a `ForbiddenError`, which
 * is what keeps a plugin free to ask a question whose answer may be 404.
 */
export interface PluginFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
