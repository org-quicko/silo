/**
 * What a planned transfer does with one entry, named as an import's preview
 * names it, or with one media asset or folder (D111), which may also be
 * `unchanged`: the destination already holds exactly it.
 */
export type TransferPlanAction = "added" | "updated" | "unchanged" | "skipped" | "rejected" | "deleted";

/**
 * One line of a transfer's `plan.ndjson` (D110): one package entry, one
 * destination entry that replace removes, or one packaged media asset or
 * folder (`_media`, `_media_folders`, D111).
 *
 * `destination` is the row as it was planned against, absent when there was
 * none. Its `seq` is the baseline Apply holds the store to, so a row that
 * moved since the review makes the transfer stale. A rejected or skipped line
 * keeps the reason; an entry line keeps the media references it holds that
 * will not resolve on this server.
 */
export interface TransferPlanLine {
  collection: string;
  id: string;
  action: TransferPlanAction;
  /** A media line's filename, or its folder's path. */
  name?: string;
  /** The package entry's; absent on a `deleted` line. */
  rev?: number;
  updated_at?: string;
  destination?: { seq: number; rev: number; updated_at: string };
  reason?: string;
  unresolved?: string[];
}
