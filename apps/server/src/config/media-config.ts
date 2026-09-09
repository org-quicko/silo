/**
 * Where media URLs point, and what the library accepts (D46, D58).
 *
 * Its own table rather than more keys in `[blob_storage]`, because none of it
 * is a driver setting: an instance on the fs driver behind a CDN wants a base
 * URL exactly as much as one on a bucket, and an allowlist is about what a
 * library takes in rather than where it puts it.
 */
export interface MediaConfig {
  /**
   * The origin media URLs are rooted at. Unset means the store's own public
   * root when it has one, and otherwise the request's origin — see
   * `MediaLinks`, which is the one place that decides.
   */
  base_url?: string;

  /**
   * Filename extensions an upload may carry, lower case and without the dot.
   * `["*"]` accepts anything, which is the only way to turn the check off.
   */
  extensions: string[];
}
