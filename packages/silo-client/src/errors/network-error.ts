/**
 * `fetch` itself rejected: the request never reached the server. Does
 * NOT extend `SiloError`, because nothing answered. A `NetworkError` on a
 * write does not prove the write did not commit — reconcile by re-reading,
 * do not blindly retry.
 */
export class NetworkError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string, cause: unknown) {
    super(`network error on ${method} ${path}: the request never reached the server`, { cause });
    this.name = "NetworkError";
    this.method = method;
    this.path = path;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}
