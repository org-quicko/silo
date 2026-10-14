/**
 * The media half of a transfer's plan (D111), kept in its record.
 *
 * `unresolved` is every media reference the written entries hold that will
 * not resolve here once the transfer lands, which the entry API would refuse
 * and a transfer writes as it is, as an import does. `resolved` is the
 * baseline for the destination assets the plan found a reference resolving
 * to without the package carrying them; it is never shown.
 */
export interface TransferMediaReview {
  added: number;
  unchanged: number;
  skipped: number;
  folders_added: number;
  unresolved: string[];
  resolved: { id: string; seq: number }[];
}
