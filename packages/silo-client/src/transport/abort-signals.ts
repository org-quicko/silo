/** Which source aborted the composed signal, so the caller can raise
 * `TimeoutError` or `RequestAbortedError` instead of one undifferentiated
 * abort. */
export type AbortReason = "caller" | "timeout";

/**
 * Composes a caller's `AbortSignal` with a timeout deadline into one signal,
 * and remembers which of the two fired first.
 *
 * Built by hand with an `AbortController` and listeners rather than
 * `AbortSignal.any`, which Node 18 does not have. Call {@link dispose} once
 * the request settles, whichever way, so the timer clears and neither
 * listener outlives the request.
 */
export class AbortSignals {
  readonly signal: AbortSignal;
  private reason: AbortReason | undefined;
  private readonly cleanups: Array<() => void> = [];

  constructor(callerSignal: AbortSignal | undefined, timeoutMilliseconds: number | undefined) {
    const controller = new AbortController();
    const fire = (reason: AbortReason): void => {
      if (this.reason) return;
      this.reason = reason;
      controller.abort();
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        fire("caller");
      } else {
        const onAbort = (): void => fire("caller");
        callerSignal.addEventListener("abort", onAbort);
        this.cleanups.push(() => callerSignal.removeEventListener("abort", onAbort));
      }
    }

    if (timeoutMilliseconds !== undefined) {
      const timer = setTimeout(() => fire("timeout"), timeoutMilliseconds);
      this.cleanups.push(() => clearTimeout(timer));
    }

    this.signal = controller.signal;
  }

  /** Which source fired, or `undefined` if the signal never aborted. */
  firedBy(): AbortReason | undefined {
    return this.reason;
  }

  /** Removes the listeners and clears the timer. Idempotent. */
  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
