import type { FetchFunction } from "../../src/transport/fetch-function";

/** One call `StubFetch` recorded: enough to assert on what `Transport` sent. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * A recording fetch: queue responses with {@link enqueue}, pass `.fetch` as
 * `SiloOptions.fetch`, then read {@link received} back. Every unit test in
 * this package uses this instead of a real network call.
 */
export class StubFetch {
  private readonly responses: Response[] = [];
  readonly received: RecordedRequest[] = [];

  enqueue(response: Response): void {
    this.responses.push(response);
  }

  /** Bound so it can be handed to `Transport` as a plain function reference. */
  fetch: FetchFunction = async (input, init) => {
    this.received.push(await StubFetch.toRecordedRequest(input, init));

    const response = this.responses.shift();
    if (!response) throw new Error("StubFetch: no response queued for this call");
    return response;
  };

  private static async toRecordedRequest(input: RequestInfo | URL, init: RequestInit | undefined): Promise<RecordedRequest> {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });

    return {
      method: init?.method ?? "GET",
      url: input instanceof URL ? input.toString() : String(input),
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
  }
}
