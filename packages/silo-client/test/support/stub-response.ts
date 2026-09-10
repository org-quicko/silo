/** Builds `Response` objects cheaply, for {@link StubFetch} to answer with. */
export class StubResponse {
  static json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  static empty(status = 204): Response {
    return new Response(null, { status });
  }

  /** The wire's `{error: {code, message, details}}` shape, at the given
   *  status. */
  static errorBody(status: number, code: string, message: string, details?: unknown): Response {
    return StubResponse.json(
      { error: { code, message, ...(details === undefined ? {} : { details }) } },
      status,
    );
  }

  /** A body that is not JSON at all — an HTML proxy error page, or a plain
   *  text answer from a route that does not promise JSON. */
  static text(body: string, status = 200, contentType = "text/plain"): Response {
    return new Response(body, { status, headers: { "content-type": contentType } });
  }
}
