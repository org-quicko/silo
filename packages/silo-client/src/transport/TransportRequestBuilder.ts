import { CachePolicy } from "../cache/CachePolicy.js";
import type { RequestOptions } from "../request-options.js";
import type { TransportQueryValue, TransportRequest } from "./transport-request.js";

/** Builds a request and its cache declaration without changing the public client method's arguments. */
export class TransportRequestBuilder {
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
