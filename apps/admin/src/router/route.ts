import type { ListQuery } from './list-query'

/**
 * Settings is split by the scope each page configures, and the URL says which
 * (see `Routes`). Server-level pages are deliberately *unscoped*: API keys and
 * the connection belong to the instance, so giving them a project prefix would
 * let one page be bookmarked at as many URLs as there are scopes.
 */
export type ServerSettingsSection =
  | 'keys'
  | 'key-new'
  | 'transfer'
  | 'connection'
  | 'appearance'
  /** Where the media library keeps its bytes: provider, credentials, and what
   *  the environment is overriding (D45). */
  | 'media-storage'
  /** The project index: every project on the instance, and creating one. */
  | 'projects'
  /** Installed plugins, and one plugin's grant, config and activity (D40). */
  | 'plugins'
  | 'plugin'
export type ProjectSettingsSection = 'general' | 'environments'
export type EnvSettingsSection = 'general' | 'transfer'

export type Route =
  | { view: 'servers' }
  | {
      view: 'server-settings'
      serverId: string
      section: ServerSettingsSection
      /** Set only by `section: 'plugin'`, which is the one server-level page
       *  addressed by a name rather than being a singleton. */
      plugin?: string
    }
  | { view: 'project-settings'; serverId: string; project: string; section: ProjectSettingsSection }
  | {
      view: 'env-settings'
      serverId: string
      project: string
      env: string
      section: EnvSettingsSection
    }
  | { view: 'collections'; serverId: string; project: string; env: string }
  | { view: 'entries'; serverId: string; project: string; env: string; collection: string; query: ListQuery }
  | { view: 'entry'; serverId: string; project: string; env: string; collection: string; entryId: string | null }
  | { view: 'schema'; serverId: string; project: string; env: string; collection: string | null }
  | { view: 'media'; serverId: string; project: string; env: string; q: string }

/** Any settings route, at whichever scope. */
export type SettingsRoute = Extract<
  Route,
  { view: 'server-settings' | 'project-settings' | 'env-settings' }
>

/**
 * The routes the connected workspace shell renders. Listed by view rather than
 * derived from "has project and env", because `env-settings` has both and is
 * not a workspace route — it renders the settings shell.
 */
export type ServerRoute = Extract<
  Route,
  { view: 'collections' | 'entries' | 'entry' | 'schema' | 'media' }
>
