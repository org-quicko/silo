import { DEFAULT_LIST_QUERY, type ListQuery } from './list-query'
import type { EnvSettingsSection, ProjectSettingsSection, Route, ServerSettingsSection } from './route'
import type { ScopeRef } from '../api/types/scope-ref'

const DEFAULT_SORT = '-$updated_at'

/**
 * URL grammar. Settings pages nest under the resource they configure, using
 * the same scope prefix as the workspace routes and the HTTP API
 * (`/api/projects/{project}/environments/{env}/…`), with `settings` as the
 * tail — so a workspace URL becomes its settings URL by swapping that tail:
 *
 *   /servers/:sid/settings/{keys,keys/new,transfer,connection,appearance}
 *   /servers/:sid/projects/:project/settings/{general,environments}
 *   /servers/:sid/projects/:project/environments/:env/settings/{general,transfer}
 *
 * Every page therefore has exactly one canonical URL: server-level pages take
 * no scope prefix, because a key or a connection belongs to the instance and
 * not to any one project.
 */
export class Routes {
  // ---- builders ----

  static servers(): string {
    return '/servers'
  }

  static serverSettings(serverId: string, section: ServerSettingsSection): string {
    const base = `/servers/${encodeURIComponent(serverId)}/settings`
    return section === 'key-new' ? `${base}/keys/new` : `${base}/${section}`
  }

  static projectSettings(serverId: string, project: string, section: ProjectSettingsSection): string {
    return `/servers/${encodeURIComponent(serverId)}/projects/${encodeURIComponent(project)}/settings/${section}`
  }

  static envSettings(
    serverId: string,
    project: string,
    env: string,
    section: EnvSettingsSection,
  ): string {
    return `${Routes.workspace(serverId, project, env)}/settings/${section}`
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
    if (segs[0] !== 'servers' || segs.length < 3) return null

    const serverId = segs[1]
    if (segs[2] === 'settings') return Routes.parseServerSettings(serverId, segs)
    if (segs[2] !== 'projects' || segs.length < 4) return null

    const project = segs[3]
    if (segs[4] === 'settings') return Routes.parseProjectSettings(serverId, project, segs[5])
    if (segs[4] !== 'environments' || segs.length < 6) return null

    const env = segs[5]
    // Checked before the workspace tail: /…/environments/:env/settings/:x is
    // the settings shell, not a collection called "settings".
    if (segs[6] === 'settings') return Routes.parseEnvSettings(serverId, project, env, segs[7])

    return Routes.parseWorkspace(serverId, project, env, segs.slice(6), search)
  }

  /**
   * Pre-restructure URLs, mapped onto their replacement so old links and
   * bookmarks keep working. Runs before `parse`, which knows nothing about
   * them. `scopeFor` supplies the project/env the flat URLs never carried;
   * with none remembered there is nothing to guess from, so those land at the
   * gate, which is where a scope gets chosen.
   */
  static legacy(location: string, scopeFor: (serverId: string) => ScopeRef | null): string | null {
    const segs = location.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent)
    if (segs[0] !== 'servers' || segs.length < 3) return null
    const serverId = segs[1]

    // `/servers/:id/status` predates the settings tree entirely.
    if (segs[2] === 'status') return Routes.serverSettings(serverId, 'connection')
    if (segs[2] !== 'settings') return null

    const section = segs[3]
    // "General" was the appearance page; it is app-wide, so it stays unscoped.
    if (section === 'general') return Routes.serverSettings(serverId, 'appearance')
    // A bare `/settings` never named a scope, and the project index needs none.
    if (section === undefined) return Routes.serverSettings(serverId, 'projects')
    if (section !== 'environments' && section !== 'envs') return null

    // This one did name an environment list, but only for whichever project the
    // old flat page happened to have selected. With nothing remembered there is
    // nothing to guess from, so it lands at the gate, where a scope is chosen.
    const scope = scopeFor(serverId)
    if (!scope) return Routes.servers()
    return Routes.projectSettings(serverId, scope.project, 'environments')
  }

  // ---- internals ----

  private static parseServerSettings(serverId: string, segs: string[]): Route | null {
    const section = segs[3]
    if (section === 'keys') {
      return segs[4] === 'new'
        ? { view: 'server-settings', serverId, section: 'key-new' }
        : { view: 'server-settings', serverId, section: 'keys' }
    }
    if (
      section === 'projects' ||
      section === 'transfer' ||
      section === 'connection' ||
      section === 'appearance'
    ) {
      return { view: 'server-settings', serverId, section }
    }
    return null
  }

  private static parseProjectSettings(serverId: string, project: string, section?: string): Route | null {
    if (section === 'general' || section === 'environments') {
      return { view: 'project-settings', serverId, project, section }
    }
    return null
  }

  private static parseEnvSettings(
    serverId: string,
    project: string,
    env: string,
    section?: string,
  ): Route | null {
    if (section === 'general' || section === 'transfer') {
      return { view: 'env-settings', serverId, project, env, section }
    }
    return null
  }

  private static parseWorkspace(
    serverId: string,
    project: string,
    env: string,
    rest: string[],
    search: string,
  ): Route | null {
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
