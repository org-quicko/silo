/**
 * A catalogued media asset — one `_media` document in `Scope.System` (D23).
 *
 * The catalog is the source of truth for everything *about* a file; the blob
 * store holds only its bytes. `blob_key` is stored rather than derived so the
 * policy that names blobs is one function and can change without a migration
 * of the record shape.
 */
export interface MediaAsset {
  filename: string;
  /** "" for the library root, else a normalised "/a/b" path. */
  folder: string;
  blob_key: string;
  size: number;
  content_type: string;
  /** sha256 of the bytes, hex. */
  hash: string;
  /**
   * `deleting` means the blob delete has been committed to but may not have
   * finished. New references to the asset are refused and startup retries the
   * remaining steps.
   */
  state: "active" | "deleting";
  tags: string[];
}
