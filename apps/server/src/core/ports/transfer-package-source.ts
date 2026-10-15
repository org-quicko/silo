/**
 * Where a prepared transfer pulls its package from (D109): another silo's
 * `POST …/package`, reached with a key the caller pasted for this transfer.
 *
 * The key lives inside the source and nowhere else, so nothing that records a
 * transfer can write it down.
 */
export interface TransferPackageSource {
  /** The source's base URL, normalised, as the transfer records it. */
  readonly url: string;

  /** The package as a gzipped tar stream. `signal` aborts the pull. */
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
