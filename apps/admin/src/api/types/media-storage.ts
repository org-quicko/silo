/**
 * Where the media library keeps its bytes (D45).
 *
 * One contract in one file, the way `plugin-install.ts` holds its request and
 * response: the read and the write only mean anything beside each other, and
 * the one field that differs between them — the secret — is the reason.
 */

/** One configuration, read out. There is no `secret_access_key`: the server
 *  reports whether one is set and never what it is. */
export interface MediaStorageFacts {
  driver: string
  path?: string
  bucket?: string
  region?: string
  endpoint?: string
  access_key_id?: string
  force_path_style?: boolean
  secret_access_key_set: boolean
}

/** A field `silo.toml` does not decide, and the variable that decides it
 *  instead. No `env` means a flag, or a file edited since the server started. */
export interface SettingsOverride {
  field: string
  env?: string
}

/**
 * What `GET /api/media/storage` returns.
 *
 * `file` is what the form edits and `in_force` is what the server is doing;
 * they differ whenever an env var or a flag outranks the file, and for the fs
 * media path, which follows the data directory while nobody has named one.
 */
export interface MediaStorageView {
  file: MediaStorageFacts
  in_force: MediaStorageFacts
  /** Every driver this server can open, so the provider list is the server's
   *  and not a copy of it here. */
  drivers: string[]
  overrides: SettingsOverride[]
  config_path?: string
  /** False when the server was started without a config file, in which case
   *  there is nothing to write and the form is read-only. */
  writable: boolean
}

/**
 * What `PUT /api/media/storage` accepts: a whole configuration, not a patch.
 *
 * `secret_access_key` is the exception the read forces. Omitted keeps the one
 * the file holds, `''` clears it, so a form that never received the secret can
 * still save every other field without wiping it.
 */
export interface MediaStorageInput {
  driver: string
  path?: string
  bucket?: string
  region?: string
  endpoint?: string
  access_key_id?: string
  secret_access_key?: string
  force_path_style?: boolean
}
