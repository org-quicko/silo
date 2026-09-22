import { describe, test, expect } from 'bun:test'
import { DocumentTitle } from './document-title'
import { DEFAULT_LIST_QUERY } from './list-query'

describe('DocumentTitle', () => {
  test('the gate names no server, because none is chosen', () => {
    expect(DocumentTitle.of(null, null)).toBe('silo - admin')
    expect(DocumentTitle.of({ view: 'servers' }, 'local')).toBe('silo - admin')
    // A route naming a server this browser no longer knows about is on its way
    // back to the gate; naming a server it cannot find would be worse.
    expect(DocumentTitle.of({ view: 'collections', serverId: 's', project: 'acme', env: 'prod' }, null))
      .toBe('silo - admin')
  })

  test('a workspace route is named by its scope, whichever page of it is open', () => {
    const at = (view: 'collections' | 'entries' | 'entry' | 'schema') =>
      DocumentTitle.of(
        view === 'collections'
          ? { view, serverId: 's', project: 'acme', env: 'prod' }
          : view === 'entries'
            ? { view, serverId: 's', project: 'acme', env: 'prod', collection: 'posts', query: DEFAULT_LIST_QUERY }
            : view === 'entry'
              ? { view, serverId: 's', project: 'acme', env: 'prod', collection: 'posts', entryId: null }
              : { view, serverId: 's', project: 'acme', env: 'prod', collection: 'posts' },
        'local',
      )
    expect(at('collections')).toBe('silo - local - acme/prod')
    expect(at('entries')).toBe('silo - local - acme/prod')
    expect(at('entry')).toBe('silo - local - acme/prod')
    expect(at('schema')).toBe('silo - local - acme/prod')
  })

  test('the media library carries the folder it is open at, and nothing at the root', () => {
    expect(DocumentTitle.of({ view: 'media', serverId: 's', folder: '', q: '' }, 'local'))
      .toBe('silo - local - Media Library')
    expect(DocumentTitle.of({ view: 'media', serverId: 's', folder: '/brand/logos', q: '' }, 'local'))
      .toBe('silo - local - Media Library /brand/logos')
  })

  test('a settings page is named as the nav names it', () => {
    expect(DocumentTitle.of({ view: 'server-settings', serverId: 's', section: 'keys' }, 'local'))
      .toBe('silo - local - Settings - API Keys')
    expect(DocumentTitle.of({ view: 'server-settings', serverId: 's', section: 'media-storage' }, 'local'))
      .toBe('silo - local - Settings - Media Library')
  })

  test('a page addressed by an identifier takes its list’s name', () => {
    // A key id or a plugin name in a tab is unreadable at tab width, and both
    // pages are reached from the list the title names.
    expect(DocumentTitle.of({ view: 'server-settings', serverId: 's', section: 'key-edit', keyId: '01ABC' }, 'local'))
      .toBe('silo - local - Settings - API Keys')
    expect(DocumentTitle.of({ view: 'server-settings', serverId: 's', section: 'plugin', plugin: '@acme/p' }, 'local'))
      .toBe('silo - local - Settings - Plugins')
  })

  test('a scoped settings page says which scope, since the nav nests the same label twice', () => {
    expect(DocumentTitle.of({ view: 'project-settings', serverId: 's', project: 'acme', section: 'general' }, 'local'))
      .toBe('silo - local - Settings - acme - General')
    expect(DocumentTitle.of({ view: 'env-settings', serverId: 's', project: 'acme', env: 'prod', section: 'general' }, 'local'))
      .toBe('silo - local - Settings - acme/prod - General')
    expect(DocumentTitle.of({ view: 'env-settings', serverId: 's', project: 'acme', env: 'prod', section: 'variables' }, 'local'))
      .toBe('silo - local - Settings - acme/prod - Variables')
    expect(DocumentTitle.of({ view: 'env-settings', serverId: 's', project: 'acme', env: 'prod', section: 'transfer' }, 'local'))
      .toBe('silo - local - Settings - acme/prod - Data Transfer')
  })
})
