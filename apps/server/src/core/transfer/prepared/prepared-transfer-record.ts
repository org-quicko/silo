import type { MediaMode } from "../media-mode";
import type { TransferPackageSummary } from "../package/transfer-package-summary";
import type { TransferReview } from "../plan/transfer-review";
import type { PreparedTransferState } from "./prepared-transfer-state";

/**
 * A prepared transfer as `record.json` holds it (D109).
 *
 * Everything Apply will act on is fixed here at prepare time: the scopes, the
 * selection and the options, so Apply takes no options of its own. The source
 * key is never part of it.
 */
export interface PreparedTransferRecord {
  id: string;
  state: PreparedTransferState;
  /** The key that prepared it. Every other key is answered as if it did not exist. */
  key_id: string;
  /** The destination, from the route. */
  to: { project: string; env: string };
  /** The source's scope, which the package's paths name. */
  from: { project: string; env: string };
  source_url: string;
  selection: { collection: string; entry_ids?: string[] }[];
  mode: "merge" | "replace";
  prefer?: "local" | "remote";
  media: MediaMode;
  created_at: string;
  updated_at: string;
  /** When a `prepared` transfer becomes `expired`. */
  expires_at: string;
  /** Set once the package is verified. */
  package?: TransferPackageSummary;
  /** Set once the package is planned against the destination (D110). */
  review?: TransferReview;
  last_error?: string;
}
