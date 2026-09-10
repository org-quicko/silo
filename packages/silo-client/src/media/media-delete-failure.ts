import type { MediaUsage } from "./media-usage.js";

/**
 * One id's outcome in a bulk delete that could not remove it. `usageCount`,
 * `visibleCount`, `visibleCapped` and `referrers` are present only for the
 * `"media_in_use"` code — `"not_found"`, `"media_delete_stalled"` and
 * `"invalid_id"` carry just `id`, `code` and `message`.
 */
export interface MediaDeleteFailure {
  id: string;
  code: string;
  message: string;
  usageCount?: number;
  visibleCount?: number;
  visibleCapped?: boolean;
  referrers?: MediaUsage[];
}
