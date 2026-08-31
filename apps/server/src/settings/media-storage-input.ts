/**
 * What `PUT /api/media/storage` accepts (D45).
 *
 * A whole document rather than a patch, because the fields are few, they are
 * all on one screen at once, and a PUT of what was read is the one shape that
 * cannot leave a stale value behind by omission.
 *
 * `secret_access_key` is the exception, and has to be: the read never returned
 * it, so a caller PUTting back what it read has nothing to send. Absent means
 * "keep what the file holds" and `""` means "clear it" — the two states a
 * write-only field needs, and the reason this is not a plain `string`.
 */
export interface MediaStorageInput {
  driver: string;
  path?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  access_key_id?: string;
  secret_access_key?: string;
  force_path_style?: boolean;
}
