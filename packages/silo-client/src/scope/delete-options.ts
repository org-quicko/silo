import type { RequestOptions } from "../request-options.js";

/**
 * `delete()`'s options across projects, environments, collections and
 * entries. `force` bypasses the server's "not empty" or "still referenced"
 * refusal.
 */
export interface DeleteOptions extends RequestOptions {
  force?: boolean;
}
