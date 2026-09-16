import { RequestAbortedError } from "../errors/request-aborted-error.js";
import { ResponseCache } from "../cache/response-cache.js";
import type { FetchTransport } from "./fetch-transport.js";
import type { TransportRequest } from "./transport-request.js";
import type { Transport } from "./transport.js";

/** Adds opt-in GET JSON caching to the fetch transport. */
export class CachingTransport implements Transport {
  readonly #fetchTransport: FetchTransport;
  readonly #cache: ResponseCache;

  constructor(fetchTransport: FetchTransport, cache: ResponseCache) {
    this.#fetchTransport = fetchTransport;
    this.#cache = cache;
  }

  async json<T>(request: TransportRequest): Promise<T> {
    if (request.method !== "GET") return this.write(() => this.#fetchTransport.json<T>(request));
    if (request.cache === "bypass") return this.#fetchTransport.json<T>(request);
    if (request.signal?.aborted) throw new RequestAbortedError(request.method, request.path);

    let prepared;
    try {
      prepared = this.#fetchTransport.prepare(request);
    } catch (caught) {
      throw this.#fetchTransport.preparationFailure(request, caught);
    }
    const key = JSON.stringify([prepared.url, [...prepared.headers]]);
    if (request.cache !== "refresh") {
      const cached = this.#cache.get(key);
      if (cached) return cached.body as T;
    }

    const ticket = this.#cache.start(key);
    try {
      const body = await this.#fetchTransport.jsonPrepared<T>(request, prepared);
      this.#cache.set(key, ticket, body);
      return body;
    } finally {
      this.#cache.finish(key, ticket);
    }
  }

  empty(request: TransportRequest): Promise<void> {
    return request.method === "GET" ? this.#fetchTransport.empty(request) : this.write(() => this.#fetchTransport.empty(request));
  }

  stream(request: TransportRequest): Promise<ReadableStream<Uint8Array> | null> {
    return request.method === "GET" ? this.#fetchTransport.stream(request) : this.write(() => this.#fetchTransport.stream(request));
  }

  upload<T>(request: TransportRequest, form: FormData): Promise<T> {
    return request.method === "GET"
      ? this.#fetchTransport.upload<T>(request, form)
      : this.write(() => this.#fetchTransport.upload<T>(request, form));
  }

  private async write<T>(dispatch: () => Promise<T>): Promise<T> {
    this.#cache.clear();
    try {
      return await dispatch();
    } finally {
      this.#cache.clear();
    }
  }
}
