import type { ListQuery } from './list-query'

export type SettingsSection =
  | 'general'
  | 'projects'
  | 'environments'
  | 'keys'
  | 'key-new'
  | 'transfer'
  | 'connection'

export type Route =
  | { view: 'servers' }
  | {
      view: 'server-settings'
      serverId: string
      section: SettingsSection
    }
  | { view: 'collections'; serverId: string; project: string; env: string }
  | { view: 'entries'; serverId: string; project: string; env: string; collection: string; query: ListQuery }
  | { view: 'entry'; serverId: string; project: string; env: string; collection: string; entryId: string | null }
  | { view: 'schema'; serverId: string; project: string; env: string; collection: string | null }
  | { view: 'media'; serverId: string; project: string; env: string }

/** Any route that names a server within a scoped workspace shell. */
export type ServerRoute = Extract<Route, { project: string; env: string }>

