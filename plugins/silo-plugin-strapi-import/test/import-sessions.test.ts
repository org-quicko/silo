import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs/promises'
import path from 'path'
import { ImportSessions } from '../src/worker/import-sessions'
import { PluginSettings } from '../src/worker/plugin-settings'
import { TempDirectory } from './support/temp-directory'

/**
 * One session per caller.
 *
 * The bug this exists to keep fixed: every import shared one staging directory
 * and one set of fields on the runtime, so a second operator's upload swept the
 * first one's database and their plan was then validated against a file they had
 * never seen.
 */
describe('one import session per caller', () => {
  let tempDir: string

  const settings = (ttlHours: number) =>
    PluginSettings.read({ config: { work_dir: tempDir, session_ttl_hours: ttlHours } } as any)

  const ctx = () => ({ log: { debug() {}, info() {}, warn() {}, error() {} } }) as any

  const request = (id: string | null) =>
    ({ caller: id === null ? null : { id, label: id + ' key', claims: [] } }) as any

  const database = new Uint8Array([1, 2, 3, 4])

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-sessions-test')
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  test('two callers stage into directories of their own', async () => {
    const sessions = new ImportSessions(settings(24))
    const first = sessions.of(request('key-a'))
    const second = sessions.of(request('key-b'))

    await first.store.put('a.db', database)
    await second.store.put('b.db', database)

    expect(first.store.require().name).toBe('a.db')
    expect(second.store.require().name).toBe('b.db')
    expect(path.dirname(first.store.require().path)).not.toBe(
      path.dirname(second.store.require().path),
    )
  })

  test('clearing one session leaves the other staged', async () => {
    const sessions = new ImportSessions(settings(24))
    const first = sessions.of(request('key-a'))
    const second = sessions.of(request('key-b'))

    await first.store.put('a.db', database)
    await second.store.put('b.db', database)
    await first.uploads.put('logo.svg', database)
    await second.uploads.put('logo.svg', database)

    await first.store.clear()
    await first.uploads.clear()

    expect(first.store.current()).toBeNull()
    expect(second.store.current()).not.toBeNull()
    expect((await second.uploads.index()).has('logo.svg')).toBe(true)
  })

  test('the same caller comes back to the same session', () => {
    const sessions = new ImportSessions(settings(24))
    expect(sessions.of(request('key-a'))).toBe(sessions.of(request('key-a')))
    expect(sessions.of(request('key-a'))).not.toBe(sessions.of(request('key-b')))
  })

  test('a caller id that is not path-safe is hashed rather than flattened', () => {
    expect(ImportSessions.keyOf({ id: '../../etc', label: '', claims: [] })).toMatch(
      /^[0-9a-f]{32}$/,
    )
    expect(ImportSessions.keyOf({ id: '../../etc', label: '', claims: [] })).not.toBe(
      ImportSessions.keyOf({ id: '../../var', label: '', claims: [] }),
    )
    expect(ImportSessions.keyOf(null)).toBe(ImportSessions.keyOf(null))
  })

  test('a restart adopts the source each session had staged', async () => {
    const before = new ImportSessions(settings(24))
    await before.of(request('key-a')).store.put('a.db', database)

    const after = new ImportSessions(settings(24))
    await after.recover(ctx())

    expect(after.of(request('key-a')).store.current()).not.toBeNull()
  })

  test('an idle session is swept and a fresh one is not', async () => {
    const sessions = new ImportSessions(settings(24))
    const stale = sessions.of(request('key-a'))
    const fresh = sessions.of(request('key-b'))
    await stale.store.put('a.db', database)
    await fresh.store.put('b.db', database)

    // Reaching into the session's own clock, which is the only way to age one
    // without waiting a day.
    ;(stale as unknown as { touchedAt: number }).touchedAt = Date.now() - 48 * 60 * 60 * 1000
    await sessions.sweep(ctx())

    expect(await fs.readdir(path.join(tempDir, ImportSessions.Directory))).toEqual([fresh.key])
  })

  test('a session with an import in flight is never swept', async () => {
    const sessions = new ImportSessions(settings(24))
    const running = sessions.of(request('key-a'))
    await running.store.put('a.db', database)

    ;(running as unknown as { touchedAt: number }).touchedAt = Date.now() - 48 * 60 * 60 * 1000
    running.busy = () => true
    await sessions.sweep(ctx())

    expect(await fs.readdir(path.join(tempDir, ImportSessions.Directory))).toEqual([running.key])
  })

  test('a lifetime of zero keeps everything', async () => {
    const sessions = new ImportSessions(settings(0))
    const session = sessions.of(request('key-a'))
    await session.store.put('a.db', database)

    ;(session as unknown as { touchedAt: number }).touchedAt = 0
    await sessions.sweep(ctx())

    expect(session.store.current()).not.toBeNull()
  })

  test('staging from before sessions existed is cleared on start', async () => {
    await fs.mkdir(path.join(tempDir, 'uploads'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'source-abc.db'), database)

    await new ImportSessions(settings(24)).recover(ctx())

    expect(await fs.readdir(tempDir)).not.toContain('uploads')
    expect(await fs.readdir(tempDir)).not.toContain('source-abc.db')
  })
})
