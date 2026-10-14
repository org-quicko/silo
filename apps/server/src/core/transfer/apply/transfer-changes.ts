import type { BlobPutOptions } from "../../ports/blob-storage";
import type { ChangeSet } from "../../ports/change-set";

/**
 * A planned transfer as Apply carries it out (D111): the one commit, the files
 * its new assets need written before it, and the folder paths it adds, which
 * must still be missing when it runs.
 */
export interface TransferChanges {
  changes: ChangeSet;
  blobs: { key: string; file: string; options: BlobPutOptions }[];
  folders: string[];
}
