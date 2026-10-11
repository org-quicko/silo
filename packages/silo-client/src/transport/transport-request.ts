import { CachePolicy } from "../cache/CachePolicy.js";
import type { RequestOptions } from "../request-options.js";

/** One query parameter's value. An object (the `filter` AST) is JSON-encoded
 *  by {@link QueryString}; everything else is stringified. */
export type TransportQueryValue = string | number | boolean | object | undefined;

/**
 * One request through {@link Transport}: an HTTP method and a path already
 * built by {@link ApiPath}, with everything else optional. `signal` and
 * `timeoutMilliseconds` here are the per-call values from {@link RequestOptions};
 * the client's own defaults apply when they are absent.
 */
export class TransportRequest {
  constructor(
    readonly method: string,
    readonly path: string,
  ) {}

  query?: Record<string, TransportQueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMilliseconds?: number;
  cachePolicy?: CachePolicy;
  evicts?: string;

  static get(path: string): Builder {
    return TransportRequest.of("GET", path);
  }

  static of(method: string, path: string): Builder {
    return new Builder(method, path);
  }
}

/** The request's internal builder, corresponding to Java's TransportRequest.Builder. */
class Builder {
  private readonly request: TransportRequest;

  constructor(method: string, path: string) {
    this.request = { method, path };
  }

  query(name: string, value: TransportQueryValue): this {
    this.request.query = { ...this.request.query, [name]: value };
    return this;
  }

  body(value: unknown): this {
    this.request.body = value;
    return this;
  }

  options(options: RequestOptions): this {
    this.request.signal = options.signal;
    this.request.timeoutMilliseconds = options.timeoutMilliseconds;
    return this;
  }

  /** Reads the decorated method explicitly; browsers have no Java-style caller discovery. */
  cache(method: object & { cachePolicy?: CachePolicy }): this {
    this.request.cachePolicy = CachePolicy.declaredOn(method);
    return this;
  }

  evicts(pathPrefix: string): this {
    this.request.evicts = pathPrefix;
    return this;
  }

  build(): TransportRequest {
    return { ...this.request };
  }
}
