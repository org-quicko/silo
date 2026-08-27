import type { PluginView } from './plugin-view'

/** What `POST /api/plugins/install` accepts (D42). Sent as JSON when the package
 *  is named, and as form fields when it is uploaded. */
export interface PluginInstallRequest {
  /** An npm spec, a git URL, an HTTPS tarball URL, or a local path. Omitted when
   *  the package is uploaded instead. */
  spec?: string
  /** Branch or tag, for a git source. */
  ref?: string
  /** `sha512-...`, for the sources that have bytes to hash. */
  integrity?: string
  registry?: string
  force?: boolean
  /** Omitted means everything the package says it **requires**, which is the
   *  same default `PUT .../grant` takes. */
  claims?: string[]
  timeout_ms?: number
  on_error?: 'fail' | 'skip'
}

/**
 * The installed plugin, as `GET /api/plugins/:name` would report it.
 *
 * `state` and `runtime` are `null` for a package that contributes only
 * providers: those are constructed before storage opens, so there is no worker
 * to authorize and no record to view — the reason is in `warnings`.
 */
export type PluginInstallResponse = Partial<PluginView> &
  Pick<PluginView, 'name'> & { warnings?: string[] }
