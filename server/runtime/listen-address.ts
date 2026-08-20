/** Parsing for the `listen` setting's `[host]:port` forms. */
export class ListenAddress {
  static readonly DefaultPort = 8090;

  /** `":8090"` (every interface), `"127.0.0.1:8090"`, or a bare `"8090"`. An
   *  unparseable port falls back to the default rather than binding 0, which
   *  would hand out a random port nothing could find again. */
  static parse(listen: string): { hostname?: string; port: number } {
    let hostname: string | undefined;
    let port = ListenAddress.DefaultPort;

    if (listen.startsWith(":")) {
      port = parseInt(listen.slice(1), 10);
    } else {
      const parts = listen.split(":");
      if (parts.length === 2) {
        hostname = parts[0] || undefined;
        port = parseInt(parts[1], 10);
      } else {
        port = parseInt(listen, 10);
      }
    }

    if (isNaN(port)) port = ListenAddress.DefaultPort;
    return { hostname, port };
  }

  /** A URL that reaches the server from this machine. A wildcard bind is
   *  probed on loopback, which is where it is also listening. */
  static healthUrl(listen: string): string {
    const { hostname, port } = ListenAddress.parse(listen);
    const host = !hostname || hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}/api/health`;
  }
}
