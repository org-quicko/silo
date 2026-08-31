/**
 * What `PUT /api/media/settings` accepts: the whole `[media]` table, not a
 * patch (D46).
 *
 * Every field is optional and an omitted one is read as *cleared*, not as
 * *keep*. That is the opposite of `MediaStorageInput`'s secret, and for the
 * opposite reason: nothing here is write-only, so the form always holds the
 * current value and a missing field can only mean the operator removed it.
 */
export interface MediaPolicyInput {
  /** `""` clears it, putting media URLs back on the request's own origin. */
  base_url?: string;
  base_url_target?: "server" | "store";
  extensions?: string[];
}
