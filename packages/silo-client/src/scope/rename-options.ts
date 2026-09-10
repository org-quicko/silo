import type { RequestOptions } from "../request-options.js";

/**
 * `rename()`'s options across projects, environments and collections.
 * `expectedId` binds the call to the record a caller already read — from a
 * dry run's report, from `list()`, or supplied directly.
 */
export interface RenameOptions extends RequestOptions {
  expectedId?: string;
  dryRun?: boolean;
}
