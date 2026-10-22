import type { CacheOptions } from "../cache/CacheOptions.js";
import { ResponseCache } from "../cache/ResponseCache.js";
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
  cache?: CacheOptions;
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
  private static readonly RETRYABLE_NETWORK_CODES = [
    "UND_ERR_SOCKET", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  ];
  readonly cache: ResponseCache;
  private readonly url: string;
  private readonly fetchFunction: FetchFunction;

  constructor(private readonly options: TransportOptions) {
    this.url = Transport.normalizeUrl(options.url);
    this.fetchFunction = Transport.resolveFetch(options.fetch);
    this.cache = new ResponseCache(options.cache);
  }

  async json<T>(request: TransportRequest): Promise<T> {
    if (request.method === "GET" && request.cachePolicy && this.cache.isEnabled()) {
      return this.cache.get(request.cachePolicy, request.method, request.path, request.query, () => this.fetchJson<T>(request));
    }
    return this.fetchJson<T>(request);
  }

  private async fetchJson<T>(request: TransportRequest): Promise<T> {
    return this.execute(request, async (response) => (await ResponseDecoder.decode(response, request, true)) as T);
  }

  /** For a `204` response: decodes it, and discards the result. */
  async empty(request: TransportRequest): Promise<void> {
    await this.execute(request, async (response) => {
      await ResponseDecoder.decode(response, request, false);
    });
  }

  /** `empty`, but answering the response headers — for a 204 that carries its
   *  result in one, which is how a delete reports its trash receipt (D113). */
  async emptyWithHeaders(request: TransportRequest): Promise<Headers> {
    return this.execute(request, async (response) => {
      await ResponseDecoder.decode(response, request, false);
      return response.headers;
    });
  }

  async stream(request: TransportRequest): Promise<ReadableStream<Uint8Array> | null> {
    return this.execute(request, async (response) => response.body);
  }

  /** Multipart upload. Never sets `Content-Type` by hand — the runtime sets
   * it, boundary included, from the `FormData` body. */
  async upload<T>(request: TransportRequest, form: FormData): Promise<T> {
    return this.execute(request, async (response) => (await ResponseDecoder.decode(response, request, true)) as T, form);
  }

  /** A new `Transport` reading a different key, sharing everything else. */
  withKey(key: string | undefined): Transport {
    return new Transport({ ...this.options, key });
  }

  /** A new `Transport` reading a different base URL, sharing everything
   * else. */
  withUrl(url: string): Transport {
    return new Transport({ ...this.options, url });
  }

  private async execute<T>(request: TransportRequest, readResponse: (response: Response) => Promise<T>, form?: FormData): Promise<T> {
    const abortSignals = new AbortSignals(request.signal, request.timeoutMilliseconds ?? this.options.timeoutMilliseconds);
    try {
      const response = await this.fetchWithRetries(request, abortSignals.signal, form);
      if (!response.ok) {
        throw ErrorFactory.fromResponseBody(response.status, request.method, request.path, await response.text());
      }
      this.cache.invalidate(request.evicts);
      return await readResponse(response);
    } catch (caught) {
      if (abortSignals.signal.aborted) throw this.createCancellationError(request, abortSignals);
      throw caught;
    } finally {
      abortSignals.dispose();
    }
  }

  private async fetchWithRetries(request: TransportRequest, signal: AbortSignal, form?: FormData, retryCount = 0): Promise<Response> {
    const url = `${this.url}${request.path}${QueryString.build(request.query)}`;
    const canRetry = request.method === "GET" && retryCount < 2;
    let response: Response | undefined;

    // Read into a local so the call carries no receiver. `this.fetchFunction(...)`
    // is a method call, which would hand the `Transport` to `fetch` as its
    // `this` — a browser rejects that outright ("Illegal invocation").
    const sendRequest = this.fetchFunction;

    signal.throwIfAborted();
    try {
      response = await sendRequest(url, {
        method: request.method,
        headers: this.buildHeaders(request, Boolean(form)),
        body: form ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
        signal,
      });
    } catch (caught) {
      if (!canRetry || signal.aborted || !Transport.isRetryableNetworkFailure(caught)) {
        throw new NetworkError(request.method, request.path, caught);
      }
    }
    if (response && (response.status < 500 || !canRetry)) return response;
    await response?.body?.cancel();
    await new Promise<void>((resolve) => setTimeout(resolve, 200 * 2 ** retryCount));
    return this.fetchWithRetries(request, signal, form, retryCount + 1);
  }

  private static isRetryableNetworkFailure(caught: unknown): boolean {
    const cause = caught instanceof Error ? caught.cause ?? caught : caught;
    if (cause === null || typeof cause !== "object") return false;
    if (!("code" in cause) || typeof cause.code !== "string") return false;
    return Transport.RETRYABLE_NETWORK_CODES.includes(cause.code);
  }

  private createCancellationError(request: TransportRequest, abortSignals: AbortSignals): Error {
    if (abortSignals.firedBy() === "timeout") {
      return new TimeoutError(request.method, request.path, request.timeoutMilliseconds ?? this.options.timeoutMilliseconds ?? 0);
    }
    return new RequestAbortedError(request.method, request.path);
  }

  private buildHeaders(request: TransportRequest, isUpload: boolean): Record<string, string> {
    const headers: Record<string, string> = { ...this.options.headers, ...request.headers };
    if (this.options.key) headers["Authorization"] = `Bearer ${this.options.key}`;
    if (!isUpload && request.body !== undefined && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private static normalizeUrl(url: string): string {
    return url.replace(/\/+$/, "");
  }

  /** The caller's own `fetch`, or the runtime's bound to the global. A
   * browser's `fetch` is a `Window` method and refuses every other receiver,
   * so the default is stored already bound rather than bare. */
  private static resolveFetch(fetchFunction: FetchFunction | undefined): FetchFunction {
    if (fetchFunction) return fetchFunction;
    if (typeof globalThis.fetch !== "function") {
      throw new Error("this runtime has no global fetch: pass one as SiloOptions.fetch");
    }
    return globalThis.fetch.bind(globalThis);
  }
}
