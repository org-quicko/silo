/**
 * Where media URLs point, and what the library accepts (D46).
 *
 * Its own table rather than more keys in `[blob_storage]`, because none of it
 * is a driver setting: an instance on the fs driver behind a CDN wants a base
 * URL exactly as much as one on a bucket, and an allowlist is about what a
 * library takes in rather than where it puts it.
 */
export interface MediaConfig {
  /**
   * The origin media URLs are rooted at. Unset means the request's own, which
   * is the only origin known to be reachable by whoever asked.
   */
  base_url?: string;

  /**
   * What `base_url` stands in front of, which decides what the URL under it
   * looks like.
   *
   * `server` is silo behind another name: `<base>/media/<id>`, addressed by
   * catalog id, so it survives a rename, streams through this process, and
   * leaves the bucket private. `store` is the bucket or a CDN over it:
   * `<base>/<blob key>`, with silo out of the read path entirely. Only the
   * second works for a reader that cannot authenticate and will not follow
   * silo's cache headers, which is every email client.
   */
  base_url_target: "server" | "store";

  /**
   * Filename extensions an upload may carry, lower case and without the dot.
   * `["*"]` accepts anything, which is the only way to turn the check off.
   */
  extensions: string[];
}
