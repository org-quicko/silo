import type { CachePolicy } from "../cache/CachePolicy.js";
import { TransportRequestBuilder } from "./TransportRequestBuilder.js";

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

  static get(path: string): TransportRequestBuilder {
    return TransportRequest.of("GET", path);
  }

  static of(method: string, path: string): TransportRequestBuilder {
    return new TransportRequestBuilder(method, path);
  }
}
