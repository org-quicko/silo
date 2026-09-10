import type { RequestOptions } from "../request-options.js";

/**
 * `MediaFolders.delete()`'s options. `recursive` takes everything inside the
 * folder with it; `force` (only meaningful with `recursive`) opts past a live
 * reference among those assets.
 */
export interface MediaFolderDeleteOptions extends RequestOptions {
  recursive?: boolean;
  force?: boolean;
}
