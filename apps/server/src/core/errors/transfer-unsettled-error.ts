/**
 * An apply failed, and so did the attempt to learn whether its commit landed
 * or to take back the files it wrote (D111). The transfer stays `applying`
 * until a later apply or the next start settles it. `cause` is what the caller
 * is answered with.
 */
export class TransferUnsettledError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`a transfer's apply could not be settled: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TransferUnsettledError";
    this.cause = cause;
  }
}
