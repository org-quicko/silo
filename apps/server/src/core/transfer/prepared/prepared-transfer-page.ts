/**
 * One page of a transfer's plan (D110), and which destination collections the
 * reader may see into: what the review shows of a row only the destination
 * holds depends on the reader's claims at the time of reading.
 */
export interface PreparedTransferPage {
  offset: number;
  limit: number;
  reveals: (collection: string) => boolean;
}
