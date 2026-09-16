import { ErrorFactory } from "../errors/error-factory.js";
import { NetworkError } from "../errors/network-error.js";
import { RequestAbortedError } from "../errors/request-aborted-error.js";
import { TimeoutError } from "../errors/timeout-error.js";
import { AbortSignals } from "./abort-signals.js";
import type { FetchFunction } from "./fetch-function.js";
import { QueryString } from "./query-string.js";
import type { PreparedTransportRequest } from "./prepared-transport-request.js";
import { ResponseDecoder } from "./response-decoder.js";
import type { TransportRequest } from "./transport-request.js";
import type { Transport } from "./transport.js";

export interface FetchTransportOptions {
  url: string;
  key?: string;
  headers?: Record<string, string>;
  timeoutMilliseconds?: number;
  fetch?: FetchFunction;
}

/** The fetch-backed implementation behind the internal transport seam. */
export class FetchTransport implements Transport {
  readonly #url: string;
  readonly #key: string | undefined;
  readonly #headers: Record<string, string>;
  readonly #timeoutMilliseconds: number | undefined;
  readonly #fetchFunction: FetchFunction;

  constructor(options: FetchTransportOptions) {
    this.#url = FetchTransport.normalizeUrl(options.url);
    this.#key = options.key;
    this.#headers = options.headers ?? {};
    this.#timeoutMilliseconds = options.timeoutMilliseconds;
    this.#fetchFunction = FetchTransport.resolveFetch(options.fetch);
  }

  async json<T>(request: TransportRequest): Promise<T> {
    const response = await this.execute(request);
    return (await ResponseDecoder.decode(response, request, true)) as T;
  }

  async jsonPrepared<T>(request: TransportRequest, prepared: PreparedTransportRequest): Promise<T> {
    const response = await this.execute(request, prepared);
    return (await ResponseDecoder.decode(response, request, true)) as T;
  }

  async empty(request: TransportRequest): Promise<void> {
    const response = await this.execute(request);
    await ResponseDecoder.decode(response, request, false);
  }

  async stream(request: TransportRequest): Promise<ReadableStream<Uint8Array> | null> {
    return (await this.execute(request)).body;
  }

  async upload<T>(request: TransportRequest, form: FormData): Promise<T> {
    const response = await this.execute(request, undefined, form);
    return (await ResponseDecoder.decode(response, request, true)) as T;
  }

  withKey(key: string | undefined): FetchTransport {
    return new FetchTransport({ ...this.snapshot(), key });
  }

  withUrl(url: string): FetchTransport {
    return new FetchTransport({ ...this.snapshot(), url });
  }

  prepare(request: TransportRequest, form?: FormData): PreparedTransportRequest {
    const rawHeaders: Record<string, string> = { ...this.#headers, ...request.headers };
    if (this.#key) rawHeaders.Authorization = `Bearer ${this.#key}`;
    if (!form && request.body !== undefined && !("Content-Type" in rawHeaders)) {
      rawHeaders["Content-Type"] = "application/json";
    }
    return {
      url: `${this.#url}${request.path}${QueryString.build(request.query)}`,
      headers: new Headers(rawHeaders),
      body: form ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
    };
  }

  preparationFailure(request: TransportRequest, caught: unknown): NetworkError {
    return new NetworkError(request.method, request.path, caught);
  }

  private snapshot(): FetchTransportOptions {
    return {
      url: this.#url,
      key: this.#key,
      headers: this.#headers,
      timeoutMilliseconds: this.#timeoutMilliseconds,
      fetch: this.#fetchFunction,
    };
  }

  private async execute(
    request: TransportRequest,
    prepared?: PreparedTransportRequest,
    form?: FormData,
  ): Promise<Response> {
    const abortSignals = new AbortSignals(request.signal, request.timeoutMilliseconds ?? this.#timeoutMilliseconds);
    const sendRequest = this.#fetchFunction;
    let response: Response;
    try {
      const outbound = prepared ?? this.prepare(request, form);
      response = await sendRequest(outbound.url, {
        method: request.method,
        headers: outbound.headers,
        body: outbound.body,
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

  private transportFailure(request: TransportRequest, abortSignals: AbortSignals, caught: unknown): Error {
    if (abortSignals.firedBy() === "timeout") {
      return new TimeoutError(request.method, request.path, request.timeoutMilliseconds ?? this.#timeoutMilliseconds ?? 0);
    }
    if (abortSignals.firedBy() === "caller") return new RequestAbortedError(request.method, request.path);
    return new NetworkError(request.method, request.path, caught);
  }

  private static normalizeUrl(url: string): string {
    return url.replace(/\/+$/, "");
  }

  private static resolveFetch(fetchFunction: FetchFunction | undefined): FetchFunction {
    if (fetchFunction) return fetchFunction;
    if (typeof globalThis.fetch !== "function") {
      throw new Error("this runtime has no global fetch: pass one as SiloOptions.fetch");
    }
    return globalThis.fetch.bind(globalThis);
  }
}
