import { ValidationError } from 'silo:api'
import type { SiloRequest } from 'silo:api'

/** Reading what a caller sent, and refusing it in the one way silo understands. */
export class RouteInput {
  /**
   * A refusal the caller can act on.
   *
   * `ValidationError` and not `Error`, so it answers 400 rather than being
   * treated as a plugin fault and put through the operator's `on_error` (§13.9).
   */
  static refuse(message: string): never {
    throw new ValidationError(message)
  }

  /** The request's JSON body, or a refusal naming what is wrong with it. */
  static json(request: SiloRequest): unknown {
    if (!request.body) RouteInput.refuse('want a JSON body')
    try {
      return JSON.parse(request.body)
    } catch {
      return RouteInput.refuse('that body is not valid JSON')
    }
  }

  /** The bytes of a route that declared `"body": { "kind": "bytes" }`, or a
   *  refusal. Empty is refused as well as absent: a zero-byte upload is a
   *  mistake somebody should hear about rather than an empty file to stage. */
  static bytes(request: SiloRequest, what: string): Uint8Array {
    if (!request.bytes || request.bytes.byteLength === 0) RouteInput.refuse(what)
    return request.bytes
  }

  /** Whatever a caught value has to say, as a string. */
  static reason(caught: unknown): string {
    return (caught as any)?.message ?? String(caught)
  }
}
