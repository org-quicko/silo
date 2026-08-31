/**
 * One media storage configuration, read out (D45).
 *
 * Used twice in a view, for the file and for what is in force, so the two are
 * comparable field by field rather than being two shapes a reader has to align
 * by hand.
 *
 * There is no `secret_access_key` and there will not be one. `set` is as much as
 * a form needs to render "configured, leave blank to keep" — everything more is
 * handing a credential back out over the API it was configured through.
 */
export interface MediaStorageFacts {
  driver: string;
  path?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  access_key_id?: string;
  force_path_style?: boolean;
  secret_access_key_set: boolean;
}
