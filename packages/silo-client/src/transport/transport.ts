import { ErrorFactory } from "../errors/error-factory.js";
import { NetworkError } from "../errors/network-error.js";
import { RequestAbortedError } from "../errors/request-aborted-error.js";
import { TimeoutError } from "../errors/timeout-error.js";
import { AbortSignals } from "./abort-signals.js";
import type { FetchFunction } from "./fetch-function.js";
import { QueryString } from "./query-string.js";
import { ResponseDecoder } from "./response-decoder.js";
import type { TransportRequest } from "./transport-request.js";

/** What `Transport` needs to construct — its own options shape. */
export interface TransportOptions {
  url: string;
  key?: string;
  headers?: Record<string, string>;
  timeoutMilliseconds?: number;
  fetch?: FetchFunction;
}

/**
 * The one place a request is made. Sends `Authorization: Bearer <key>`
 * when a key is set and nothing when it is not, since anonymous reads are
 * legal. A `fetch` rejection becomes `NetworkError`; an abort from the
 * caller's own signal becomes `RequestAbortedError`; an abort from the
 * deadline becomes `TimeoutError` — `AbortSignals` is what tells the three
 * apart.
 */
export class Transport {
  private readonly url: string;
  private readonly key: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly timeoutMilliseconds: number | undefined;
  private readonly fetchFunction: FetchFunction;

  constructor(options: TransportOptions) {
    this.url = Transport.normalizeUrl(options.url);
    this.key = options.key;
    this.headers = options.headers ?? {};
    this.timeoutMilliseconds = options.timeoutMilliseconds;
    this.fetchFunction = options.fetch ?? fetch;
  }

  async json<T>(request: TransportRequest): Promise<T> {
    const response = await this.execute(request);
    return (await ResponseDecoder.decode(response, request, true)) as T;
  }

  /** For a `204` response: decodes it, and discards the result. */
  async empty(request: TransportRequest): Promise<void> {
    const response = await this.execute(request);
    await ResponseDecoder.decode(response, request, false);
  }

  async stream(request: TransportRequest): Promise<ReadableStream<Uint8Array> | null> {
    const response = await this.execute(request);
    return response.body;
  }

  /** Multipart upload. Never sets `Content-Type` by hand — the runtime sets
   * it, boundary included, from the `FormData` body. */
  async upload<T>(request: TransportRequest, form: FormData): Promise<T> {
    const response = await this.execute(request, form);
    return (await ResponseDecoder.decode(response, request, true)) as T;
  }

  /** A new `Transport` reading a different key, sharing everything else. */
  withKey(key: string | undefined): Transport {
    return new Transport({ ...this.snapshot(), key });
  }

  /** A new `Transport` reading a different base URL, sharing everything
   * else. */
  withUrl(url: string): Transport {
    return new Transport({ ...this.snapshot(), url });
  }

  private snapshot(): TransportOptions {
    return {
      url: this.url,
      key: this.key,
      headers: this.headers,
      timeoutMilliseconds: this.timeoutMilliseconds,
      fetch: this.fetchFunction,
    };
  }

  private async execute(request: TransportRequest, form?: FormData): Promise<Response> {
    const abortSignals = new AbortSignals(request.signal, request.timeoutMilliseconds ?? this.timeoutMilliseconds);
    const url = `${this.url}${request.path}${QueryString.build(request.query)}`;

    let response: Response;
    try {
      response = await this.fetchFunction(url, {
        method: request.method,
        headers: this.buildHeaders(request, Boolean(form)),
        body: form ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
        signal: abortSignals.signal,
      });
    } catch (caught) {
      throw this.transportFailure(request, abortSignals, caught);
    } finally {
      abortSignals.dispose();
    }

    if (!response.ok) {
      throw ErrorFactory.fromResponseBody(response.status, request.method, request.path, await response.text());
    }
    return response;
  }

  /** Distinguishes why `fetch` itself failed: the deadline, the caller's own
   * signal, or the request never landing at all. */
  private transportFailure(request: TransportRequest, abortSignals: AbortSignals, caught: unknown): Error {
    const firedBy = abortSignals.firedBy();
    if (firedBy === "timeout") {
      return new TimeoutError(request.method, request.path, request.timeoutMilliseconds ?? this.timeoutMilliseconds ?? 0);
    }
    if (firedBy === "caller") {
      return new RequestAbortedError(request.method, request.path);
    }
    return new NetworkError(request.method, request.path, caught);
  }

  private buildHeaders(request: TransportRequest, isUpload: boolean): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers, ...request.headers };
    if (this.key) headers["Authorization"] = `Bearer ${this.key}`;
    if (!isUpload && request.body !== undefined && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private static normalizeUrl(url: string): string {
    return url.replace(/\/+$/, "");
  }
}
