import { DEFAULT_LIST_QUERY, type ListQuery } from './list-query'
import type { Route, SettingsSection } from './route'

const DEFAULT_SORT = '-$updated_at'

export class Routes {
  // ---- builders ----

  static servers(): string {
    return '/servers'
  }

  // Server Settings (unscoped)
  static settings(serverId: string, section: SettingsSection = 'general'): string {
    if (section === 'key-new') {
      return `/servers/${encodeURIComponent(serverId)}/settings/keys/new`
    }
    return `/servers/${encodeURIComponent(serverId)}/settings/${encodeURIComponent(section)}`
  }

  static settingsGeneral(serverId: string): string {
    return Routes.settings(serverId, 'general')
  }

  static settingsProjects(serverId: string): string {
    return Routes.settings(serverId, 'projects')
  }

  static settingsEnvironments(serverId: string): string {
    return Routes.settings(serverId, 'environments')
  }

  static settingsKeys(serverId: string): string {
    return Routes.settings(serverId, 'keys')
  }

  static settingsNewKey(serverId: string): string {
    return Routes.settings(serverId, 'key-new')
  }

  static settingsTransfer(serverId: string): string {
    return Routes.settings(serverId, 'transfer')
  }

  static settingsConnection(serverId: string): string {
    return Routes.settings(serverId, 'connection')
  }

  // Scoped Workspace Routes
  static workspace(serverId: string, project: string, env: string): string {
    return `/servers/${encodeURIComponent(serverId)}/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}`
  }

  static collections(serverId: string, project: string, env: string): string {
    return `${Routes.workspace(serverId, project, env)}/collections`
  }

  static entries(serverId: string, project: string, env: string, name: string, query: ListQuery = DEFAULT_LIST_QUERY): string {
    return Routes.collection(serverId, project, env, name) + Routes.encodeQuery(query)
  }

  static entry(serverId: string, project: string, env: string, name: string, id: string): string {
    return `${Routes.collection(serverId, project, env, name)}/entries/${encodeURIComponent(id)}`
  }

  static newEntry(serverId: string, project: string, env: string, name: string): string {
    return `${Routes.collection(serverId, project, env, name)}/entries/new`
  }

  /** `null` name = the create-a-collection form, which has no collection yet. */
  static schema(serverId: string, project: string, env: string, name: string | null): string {
    return name
      ? `${Routes.collection(serverId, project, env, name)}/schema`
      : `${Routes.workspace(serverId, project, env)}/schema/new`
  }

  static media(serverId: string, project: string, env: string): string {
    return `${Routes.workspace(serverId, project, env)}/media`
  }

  // ---- parsing ----

  /** `null` for anything unrecognised (including `/`); the caller redirects. */
  static parse(location: string): Route | null {
    const [pathname, search = ''] = location.split('?')
    const segs = pathname.split('/').filter(Boolean).map(decodeURIComponent)

    if (segs.length === 1 && segs[0] === 'servers') return { view: 'servers' }

    // /servers/:serverId/settings/* or /servers/:serverId/status
    if (segs.length >= 2 && segs[0] === 'servers') {
      if (segs[2] === 'settings' || segs[2] === 'status') {
        const serverId = segs[1]
        const section = segs[3]
        if (!section || section === 'general') return { view: 'server-settings', serverId, section: 'general' }
        if (section === 'projects') return { view: 'server-settings', serverId, section: 'projects' }
        if (section === 'environments' || section === 'envs') return { view: 'server-settings', serverId, section: 'environments' }
        if (section === 'keys') {
          return segs.length >= 5 && segs[4] === 'new'
            ? { view: 'server-settings', serverId, section: 'key-new' }
            : { view: 'server-settings', serverId, section: 'keys' }
        }
        if (section === 'transfer') return { view: 'server-settings', serverId, section: 'transfer' }
        if (section === 'connection' || segs[2] === 'status') return { view: 'server-settings', serverId, section: 'connection' }
        return { view: 'server-settings', serverId, section: 'general' }
      }
    }

    if (segs.length < 6) return null
    if (segs[0] !== 'servers' || segs[2] !== 'projects' || segs[4] !== 'environments') return null

    const serverId = segs[1]
    const project = segs[3]
    const env = segs[5]
    const rest = segs.slice(6)

    if (rest.length === 0 || (rest.length === 1 && rest[0] === 'collections')) {
      return { view: 'collections', serverId, project, env }
    }

    if (rest.length === 1 && rest[0] === 'media') {
      return { view: 'media', serverId, project, env }
    }

    if (rest[0] === 'schema') {
      return rest.length === 2 && rest[1] === 'new'
        ? { view: 'schema', serverId, project, env, collection: null }
        : null
    }
    if (rest[0] !== 'collections') return null

    const collection = rest[1]
    if (rest.length === 2) {
      return { view: 'entries', serverId, project, env, collection, query: Routes.decodeQuery(search) }
    }
    if (rest.length === 3 && rest[2] === 'schema') {
      return { view: 'schema', serverId, project, env, collection }
    }
    if (rest.length === 4 && rest[2] === 'entries') {
      return { view: 'entry', serverId, project, env, collection, entryId: rest[3] === 'new' ? null : rest[3] }
    }
    return null
  }

  // ---- internals ----

  private static collection(serverId: string, project: string, env: string, name: string): string {
    return `${Routes.collections(serverId, project, env)}/${encodeURIComponent(name)}`
  }

  /** Only non-default params are written, so the common URL stays clean. */
  private static encodeQuery(query: ListQuery): string {
    const params = new URLSearchParams()
    if (query.q) params.set('q', query.q)
    const sort = (query.desc ? '-' : '') + query.sort
    if (sort !== DEFAULT_SORT) params.set('sort', sort)
    if (query.page > 1) params.set('page', String(query.page))
    const encoded = params.toString()
    return encoded ? `?${encoded}` : ''
  }

  private static decodeQuery(search: string): ListQuery {
    const params = new URLSearchParams(search)
    const sort = params.get('sort') || DEFAULT_SORT
    const desc = sort.startsWith('-')
    const page = Number.parseInt(params.get('page') || '1', 10)
    return {
      q: params.get('q') || '',
      sort: desc ? sort.slice(1) : sort,
      desc,
      page: Number.isFinite(page) && page > 0 ? page : 1,
    }
  }
}
