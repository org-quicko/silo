import type { TransportRequest } from "./transport-request.js";

/** The requests every client handle issues. */
export interface Transport {
  json<T>(request: TransportRequest): Promise<T>;
  empty(request: TransportRequest): Promise<void>;
  stream(request: TransportRequest): Promise<ReadableStream<Uint8Array> | null>;
  upload<T>(request: TransportRequest, form: FormData): Promise<T>;
}
