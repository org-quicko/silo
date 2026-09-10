/**
 * The deadline `AbortSignals` composed fired before an answer came back
 *. Distinct from {@link RequestAbortedError} so a caller can tell "I
 * cancelled this" from "this took too long" without inspecting a reason.
 */
export class TimeoutError extends Error {
  readonly method: string;
  readonly path: string;
  readonly timeoutMilliseconds: number;

  constructor(method: string, path: string, timeoutMilliseconds: number) {
    super(`${method} ${path} timed out after ${timeoutMilliseconds}ms`);
    this.name = "TimeoutError";
    this.method = method;
    this.path = path;
    this.timeoutMilliseconds = timeoutMilliseconds;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}
