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
    super(
      `network error on ${method} ${path}: the request never reached the server${NetworkError.reason(cause)}`,
      { cause },
    );
    this.name = "NetworkError";
    this.method = method;
    this.path = path;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }

  /** What `fetch` rejected with, in the message itself: a `cause` chain is
   * printed by some consoles and by no log line, and "never reached the
   * server" alone reads as a verdict on the network when the fault can be the
   * call. */
  private static reason(cause: unknown): string {
    if (cause instanceof Error && cause.message) return ` (${cause.message})`;
    if (typeof cause === "string" && cause) return ` (${cause})`;
    return "";
  }
}
