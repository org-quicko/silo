import type { SettingsOverride } from './media-storage'

/**
 * Where media URLs point and what the library accepts (D46).
 *
 * The `[media]` half of the settings page. Its sibling in `media-storage.ts`
 * holds `[blob_storage]`, and they are separate files because they are separate
 * tables behind separate routes: changing an allowlist does not re-open a
 * bucket, and a failure in one must not block the other.
 */

/** One configuration, as the server reports it. */
export interface MediaPolicyFacts {
  /** Unset means media URLs are rooted at the address each request arrived on. */
  base_url?: string
  /** `server`: `<base>/media/<id>`, streamed by silo. `store`: `<base>/<blob
   *  key>`, served by the bucket or a CDN with silo out of the read path. */
  base_url_target: 'server' | 'store'
  /** Lower case, no dots. `['*']` accepts anything. */
  extensions: string[]
}

/**
 * What `GET /api/media/settings` returns.
 *
 * `file` is what the form edits and `in_force` is what the server is doing;
 * they differ whenever a `SILO_MEDIA_*` variable outranks the file. `file` is
 * partial because a `[media]` that names only `base_url` has not also decided
 * the extension list.
 */
export interface MediaPolicyView {
  file: Partial<MediaPolicyFacts>
  in_force: MediaPolicyFacts
  overrides: SettingsOverride[]
  /** What a new instance starts with, so the page can offer it back. */
  default_extensions: string[]
  config_path?: string
  writable: boolean
  /** Why a save cannot land, when one cannot. See `MediaStorageView`. */
  read_only_reason?: string
}

/** What `PUT /api/media/settings` accepts. An omitted field is cleared, not
 *  kept: nothing here is write-only, so the form always holds the real value. */
export interface MediaPolicyInput {
  base_url?: string
  base_url_target?: 'server' | 'store'
  extensions?: string[]
}
