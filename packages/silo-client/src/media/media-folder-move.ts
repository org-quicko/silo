import type { RequestOptions } from "../request-options.js";

/**
 * `MediaFolders.rename()`'s options. `merge` opts into joining an existing
 * destination instead of refusing on collision — the same authority that
 * already governs where a folder sits.
 */
export interface MediaFolderMoveOptions extends RequestOptions {
  merge?: boolean;
}
