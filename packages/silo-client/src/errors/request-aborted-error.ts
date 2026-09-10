/**
 * The caller's own `AbortSignal` fired. Distinct from
 * {@link TimeoutError}: this one is the caller changing its mind, not a
 * deadline the client imposed.
 */
export class RequestAbortedError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string) {
    super(`${method} ${path} was aborted by the caller`);
    this.name = "RequestAbortedError";
    this.method = method;
    this.path = path;
    Object.setPrototypeOf(this, RequestAbortedError.prototype);
  }
}
