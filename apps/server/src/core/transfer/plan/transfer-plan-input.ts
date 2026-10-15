import type { Scope } from "../../domain/scope";
import type { BlobStorage } from "../../ports/blob-storage";
import type { MediaMode } from "../media-mode";
import type { PackagedEntry } from "../package/packaged-entry";
import type { TransferPackageContent } from "./transfer-package-content";

/**
 * What `TransferPlanner` plans from (D110, D111): a verified package, read
 * through `content`, and the options fixed when it was prepared. The package's
 * own scope never appears: its content lands in `to`.
 */
export interface TransferPlanInput {
  to: Scope;
  mode: "merge" | "replace";
  prefer?: "local" | "remote";
  media: MediaMode;
  /** The source instance, for the last tie-break of `ImportRules.incomingWins`. */
  instanceId: string;
  /** The selected collections. */
  collections: readonly string[];
  /** Every packaged entry, as the verifier counted them. */
  entries: readonly PackagedEntry[];
  content: TransferPackageContent;
  /** This server's blob store, asked only whether a key is taken. */
  blobs: Pick<BlobStorage, "exists">;
}
