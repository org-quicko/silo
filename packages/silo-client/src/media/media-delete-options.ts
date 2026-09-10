import type { RequestOptions } from "../request-options.js";

/**
 * `MediaAsset.delete()` and `Media.deleteMany()`'s options. `force` skips the
 * usage check and deletes over a live reference — it also needs
 * `entries:update` on every scope the asset actually reaches.
 */
export interface MediaDeleteOptions extends RequestOptions {
  force?: boolean;
}
