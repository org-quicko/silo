/**
 * Connection-level settings for the listener itself, as distinct from what the
 * routes do once a request is in.
 *
 * There is one setting because there was one thing the runtime decided for us
 * and got wrong for silo's shape — see §10.3 in
 * [docs/design/configuration.md](../../../../docs/design/configuration.md).
 */
export interface HttpConfig {
  /**
   * Seconds a connection may go quiet before the server closes it. `0`
   * disables the guard; the runtime refuses anything above 255.
   *
   * Silo's default is deliberately far above Bun's own 10, because a transfer
   * route can legitimately say nothing for a while and a closed socket reaches
   * the caller as a proxy error naming the proxy rather than the cause.
   */
  idle_timeout: number;
}
