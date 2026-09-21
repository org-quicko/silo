/**
 * Connection-level settings for the listener itself, as distinct from what the
 * routes do once a request is in.
 *
 * Each one is a value the runtime decided for us and got wrong for silo's shape
 * — see §10.3 and §10.4 in
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

  /**
   * Megabytes one request body may carry, on any route. The runtime buffers a
   * body it has not been asked for, so this is the memory one connection can
   * hold: it bounds the upload routes (media, import, plugin install, plugin
   * routes), and is the ceiling behind `max_json_body_size_mb` everywhere else.
   */
  max_body_size_mb: number;

  /**
   * Megabytes a route that takes a JSON document accepts — every `/api` route
   * that is not one of the four upload routes or a plugin route. Refused before
   * a handler runs, from `Content-Length` where there is one and by counting
   * where there is not.
   */
  max_json_body_size_mb: number;
}
