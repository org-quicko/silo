import { describe, expect, test } from 'bun:test'
import { JsonPath } from '@silo/shared/json-path'
import { Routes } from './routes'
import type { Route } from './route'
import { DEFAULT_LIST_QUERY, type ListQuery } from './list-query'

/**
 * The URL grammar, which is the part of the admin UI a mistake is quietest in:
 * a settings section that silently stops parsing just redirects to the gate,
 * and a builder that stops round-tripping produces a link that looks right and
 * lands nowhere. Both are cheap to pin and expensive to notice by hand.
 *
 * Pure string→object logic with no React and no DOM, so it runs under the same
 * root `bun test` as the server suites.
 */
const shape = (route: Route | null): string =>
  route === null ? 'null' : 'section' in route ? `${route.view}:${route.section}` : route.view

describe('Routes.parse', () => {
  test.each([
    ['/servers', 'servers'],
    ['/servers/s1/settings/projects', 'server-settings:projects'],
    ['/servers/s1/settings/keys', 'server-settings:keys'],
    ['/servers/s1/settings/keys/new', 'server-settings:key-new'],
    ['/servers/s1/settings/transfer', 'server-settings:transfer'],
    ['/servers/s1/settings/connection', 'server-settings:connection'],
    ['/servers/s1/settings/appearance', 'server-settings:appearance'],
    ['/servers/s1/settings/plugins', 'server-settings:plugins'],
    ['/servers/s1/settings/plugins/silo-plugin-slug', 'server-settings:plugin'],
    ['/servers/s1/projects/acme/settings/general', 'project-settings:general'],
    ['/servers/s1/projects/acme/settings/environments', 'project-settings:environments'],
    ['/servers/s1/projects/acme/environments/prod/settings/general', 'env-settings:general'],
    ['/servers/s1/projects/acme/environments/prod/settings/transfer', 'env-settings:transfer'],
  ])('reads the settings scope out of %s', (path, expected) => {
    expect(shape(Routes.parse(path))).toBe(expected)
  })

  test.each([
    ['/servers/s1/projects/acme/environments/prod', 'collections'],
    ['/servers/s1/projects/acme/environments/prod/collections', 'collections'],
    ['/servers/s1/projects/acme/environments/prod/collections/posts', 'entries'],
    ['/servers/s1/projects/acme/environments/prod/collections/posts/schema', 'schema'],
    ['/servers/s1/projects/acme/environments/prod/collections/posts/entries/abc', 'entry'],
    ['/servers/s1/projects/acme/environments/prod/schema/new', 'schema'],
    ['/servers/s1/projects/acme/environments/prod/media', 'media'],
  ])('still reads the workspace route %s', (path, expected) => {
    expect(shape(Routes.parse(path))).toBe(expected)
  })

  test('an environment settings URL is not read as a collection named "settings"', () => {
    const route = Routes.parse('/servers/s1/projects/acme/environments/prod/settings/general')
    expect(route).toEqual({
      view: 'env-settings',
      serverId: 's1',
      project: 'acme',
      env: 'prod',
      section: 'general',
    })
  })

  test.each([
    ['/', 'the root'],
    ['/servers/s1', 'a server with no page'],
    ['/servers/s1/settings/bogus', 'an unknown server section'],
    ['/servers/s1/projects/acme/settings/bogus', 'an unknown project section'],
    ['/servers/s1/projects/acme/environments/prod/settings/bogus', 'an unknown env section'],
  ])('returns null for %s (%s)', (path) => {
    expect(Routes.parse(path)).toBeNull()
  })

  test('scope ids are decoded, and list query params survive', () => {
    const route = Routes.parse('/servers/s1/projects/a%20cme/environments/prod/collections/posts?page=3&q=hi')
    expect(route).toMatchObject({ view: 'entries', project: 'a cme', query: { page: 3, q: 'hi' } })
  })
})

/**
 * The list URL carries the whole view — text, sort, filter and page — because
 * a filtered list that cannot be linked to is a filtered list nobody shares.
 */
describe('the list query in the URL', () => {
  const queryOf = (url: string) => {
    const route = Routes.parse(url)
    if (!route || route.view !== 'entries') throw new Error(`not an entries route: ${url}`)
    return route.query
  }
  const entries = (query: ListQuery) => Routes.entries('s1', 'acme', 'prod', 'posts', query)

  test('no sort in the URL means no sort was chosen, which is what lets search rank', () => {
    expect(queryOf('/servers/s1/projects/acme/environments/prod/collections/posts')).toEqual(
      DEFAULT_LIST_QUERY,
    )
    // And the builder writes nothing back, rather than pinning the default.
    expect(entries(DEFAULT_LIST_QUERY)).not.toContain('sort=')
  })

  test('a chosen sort round-trips, direction included', () => {
    const url = entries({ ...DEFAULT_LIST_QUERY, sort: JsonPath.dataField('title'), desc: false })
    expect(url).toContain('sort=%24.data.title')
    expect(queryOf(url)).toMatchObject({ sort: '$.data.title', desc: false })
  })

  test('a filter round-trips as the AST the API takes', () => {
    const filter = JSON.stringify({ op: 'eq', path: '$.data.draft', value: true })
    expect(queryOf(entries({ ...DEFAULT_LIST_QUERY, filter }))).toMatchObject({ filter })
  })

  test('a filter that is not JSON is carried, not dropped', () => {
    // Dropping it would widen the list to everything while the URL still
    // claims to be filtered; the view refuses instead.
    expect(queryOf('/servers/s1/projects/acme/environments/prod/collections/posts?filter=%7Bbroken')
      .filter).toBe('{broken')
  })

  test('a sort bookmarked before D29 still opens', () => {
    expect(queryOf('/servers/s1/projects/acme/environments/prod/collections/posts?sort=-%24updated_at'))
      .toMatchObject({ sort: '$.updated_at', desc: true })
    expect(queryOf('/servers/s1/projects/acme/environments/prod/collections/posts?sort=title'))
      .toMatchObject({ sort: '$.data.title', desc: false })
  })

  test('a chosen column selection round-trips', () => {
    const url = entries({ ...DEFAULT_LIST_QUERY, cols: 'email,tags' })
    expect(url).toContain('cols=email%2Ctags')
    expect(queryOf(url)).toMatchObject({ cols: 'email,tags' })
  })

  test('no `cols` in the URL means the derived default, not an empty table', () => {
    expect(queryOf('/servers/s1/projects/acme/environments/prod/collections/posts').cols).toBeNull()
  })
})

describe('Routes builders', () => {
  test.each([
    [Routes.serverSettings('s1', 'projects'), 'server-settings:projects'],
    [Routes.serverSettings('s1', 'keys'), 'server-settings:keys'],
    [Routes.serverSettings('s1', 'key-new'), 'server-settings:key-new'],
    [Routes.serverSettings('s1', 'transfer'), 'server-settings:transfer'],
    [Routes.serverSettings('s1', 'connection'), 'server-settings:connection'],
    [Routes.serverSettings('s1', 'appearance'), 'server-settings:appearance'],
    [Routes.serverSettings('s1', 'plugins'), 'server-settings:plugins'],
    [Routes.plugin('s1', 'silo-plugin-slug'), 'server-settings:plugin'],
    [Routes.projectSettings('s1', 'acme', 'general'), 'project-settings:general'],
    [Routes.projectSettings('s1', 'acme', 'environments'), 'project-settings:environments'],
    [Routes.envSettings('s1', 'acme', 'prod', 'general'), 'env-settings:general'],
    [Routes.envSettings('s1', 'acme', 'prod', 'transfer'), 'env-settings:transfer'],
  ])('%s round-trips through parse', (url, expected) => {
    expect(shape(Routes.parse(url))).toBe(expected)
  })

  test('server-level settings carry no scope prefix, so each has one canonical URL', () => {
    expect(Routes.serverSettings('s1', 'keys')).toBe('/servers/s1/settings/keys')
    expect(Routes.serverSettings('s1', 'keys')).not.toContain('projects')
  })

  test('a plugin page carries the name it is about', () => {
    expect(Routes.parse(Routes.plugin('s1', 'silo-plugin-slug'))).toEqual({
      view: 'server-settings',
      serverId: 's1',
      section: 'plugin',
      plugin: 'silo-plugin-slug',
    })
  })

  /** A package name is a URL segment like any other, and npm scopes put a
   *  slash in one — so it has to survive the round trip encoded. */
  test('a scoped package name round-trips', () => {
    const route = Routes.parse(Routes.plugin('s1', '@acme/silo-plugin-mirror'))
    expect(route).toMatchObject({ section: 'plugin', plugin: '@acme/silo-plugin-mirror' })
  })

  test('an environment settings URL is its workspace URL with a new tail', () => {
    expect(Routes.envSettings('s1', 'acme', 'prod', 'general')).toBe(
      `${Routes.workspace('s1', 'acme', 'prod')}/settings/general`,
    )
  })
})

describe('Routes.legacy', () => {
  const remembered = () => ({ project: 'acme', env: 'prod' })

  test.each([
    ['/servers/s1/settings/general', '/servers/s1/settings/appearance'],
    ['/servers/s1/status', '/servers/s1/settings/connection'],
    ['/servers/s1/settings/environments', '/servers/s1/projects/acme/settings/environments'],
    ['/servers/s1/settings/envs', '/servers/s1/projects/acme/settings/environments'],
    ['/servers/s1/settings', '/servers/s1/settings/projects'],
  ])('rewrites %s', (from, to) => {
    expect(Routes.legacy(from, remembered)).toBe(to)
  })

  test('the project index is a page again, not an alias', () => {
    // It was one briefly, when the flat settings list had no projects page.
    expect(Routes.legacy('/servers/s1/settings/projects', remembered)).toBeNull()
    expect(Routes.parse('/servers/s1/settings/projects')).toEqual({
      view: 'server-settings',
      serverId: 's1',
      section: 'projects',
    })
  })

  test.each([
    '/servers/s1/settings/keys',
    '/servers/s1/settings/projects',
    '/servers/s1/settings/appearance',
    '/servers/s1/projects/acme/settings/general',
    '/servers/s1/projects/acme/environments/prod',
    '/servers',
  ])('leaves the current URL %s alone', (path) => {
    expect(Routes.legacy(path, remembered)).toBeNull()
  })

  test('a scoped alias with nothing remembered goes to the gate, which is where a scope is chosen', () => {
    expect(Routes.legacy('/servers/s1/settings/environments', () => null)).toBe('/servers')
    // A bare `/settings` needs no scope, so it resolves either way.
    expect(Routes.legacy('/servers/s1/settings', () => null)).toBe('/servers/s1/settings/projects')
  })

  test('every rewrite target is itself parseable', () => {
    for (const from of [
      '/servers/s1/settings/general',
      '/servers/s1/status',
      '/servers/s1/settings/environments',
      '/servers/s1/settings/envs',
      '/servers/s1/settings',
    ]) {
      const to = Routes.legacy(from, remembered)
      expect(to).not.toBeNull()
      expect(Routes.parse(to!)).not.toBeNull()
      // And the replacement must not itself be an alias, or App would loop.
      expect(Routes.legacy(to!, remembered)).toBeNull()
    }
  })
})
