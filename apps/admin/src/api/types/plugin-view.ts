import type { PluginStatus } from './plugin-status'

/** The state of a plugin's grant record (D34). `pending` is installed and
 *  loaded but approved for nothing; `needs_review` is an upgrade that asked for
 *  more than it was granted, still running on what it had. */
export type PluginState = 'pending' | 'granted' | 'needs_review' | 'revoked'

/** What `GET /api/plugins` returns per plugin (D38, D39, D40). */
export interface PluginView {
  name: string
  state: PluginState
  enabled: boolean
  /** What the manifest asks for. */
  requested: string[]
  /** The subset of `requested` the package says it cannot work without (D36).
   *  What `PUT .../grant` approves when no `claims` are sent, and therefore what
   *  a form has to tick when it opens on an unapproved plugin. */
  required: string[]
  /** What the operator approved **through the record** — the half this API can
   *  change. */
  granted: string[]
  /**
   * What `silo.toml` grants this plugin.
   *
   * Effective authority is the union of the two (D34), so a surface reading
   * only `granted` reports a plugin granted entirely through the file as
   * approved for nothing — which it is not.
   */
  config_claims: string[]
  /** `granted` unioned with `config_claims`: what the plugin actually holds. */
  effective: string[]
  /** `requested` minus `effective`, computed by the server so no client becomes
   *  a second implementation of the wildcard-aware comparison. */
  not_granted: string[]
  hooks: string[]
  /** The managed key carrying the grant; its id only, never a secret. */
  key_id: string | null
  granted_by: string | null
  granted_at: string | null
  /** Send back as `If-Match` on every call that writes the record. */
  rev: number
  runtime: PluginStatus
  config: Record<string, unknown>
  config_source: 'silo.toml' | 'store'
  /**
   * What the package contributes (D36). `null` when it could not be read;
   * `runtime.detail` says why.
   *
   * It replaced `kind`, which could describe a package doing one thing and had
   * no way to describe one doing two. `routes` is where a route decision has any
   * detail — `http:route` is one claim covering all of them — and `auth:
   * "public"` is the part that carries weight, because a handler runs with the
   * plugin's authority rather than the caller's.
   */
  contributes: PluginContributions | null
  /** Claim to the author's reason for wanting it, derived claims included.
   *  `{}` when the package could not be read. */
  reasons: Record<string, string>
  /** JSON Schema for the config block, or `null` when the plugin takes none. */
  config_schema: unknown | null
}

/** Everything a package contributes, none of it exclusive (D36). */
export interface PluginContributions {
  hooks: string[]
  routes: PluginRoute[]
  /** Whether it exports `activate`/`deactivate` — it runs code of its own
   *  accord, not only in answer to a hook or a request. */
  runtime: boolean
  providers: PluginProvider[]
}

/** One storage or blob driver a package registers (D36). */
export interface PluginProvider {
  port: 'storage' | 'blob'
  driver: string
  entry: string
}

/** One route a plugin declares (D36). */
export interface PluginRoute {
  method: string
  /** Relative to `/api/ext/{name}`, and may name `:params`. */
  path: string
  auth: "key" | "public"
}
