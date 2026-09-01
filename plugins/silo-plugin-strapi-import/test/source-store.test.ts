import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'fs/promises'
import path from 'path'
import { SourceStore } from '../src/staging/source-store'
import { TempDirectory } from './support/temp-directory'

/**
 * Staging an upload.
 *
 * Every test here is about a failure that only appears on Windows, which is why
 * they exist: a file SQLite has read is not reliably deletable the instant its
 * handle is closed, so reusing one filename made the **second** upload of a
 * session fail `EBUSY` after transferring every byte correctly.
 */
describe('staging an uploaded database', () => {
  let tempDir: string
  let store: SourceStore

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-store-test')
    store = new SourceStore(tempDir)
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  const staged = async () =>
    (await fs.readdir(tempDir)).filter((entry) => entry.startsWith('source-'))

  test('a second upload lands even while the first is still open', async () => {
    const first = await store.put('a.db', new Uint8Array([1, 2, 3]))
    // Held open deliberately: this is the state that used to make the next
    // upload fail, and closing it would test nothing.
    const held = new Database(first.path, { readonly: true })
    try {
      const second = await store.put('b.db', new Uint8Array([4, 5, 6, 7]))
      expect(second.path).not.toBe(first.path)
      expect(second.bytes).toBe(4)
      expect(store.current()?.path).toBe(second.path)
    } finally {
      held.close(true)
    }
  })

  test('successive uploads never share a name, however fast they arrive', async () => {
    // No sleep on purpose: fifty puts land well inside one millisecond, which a
    // name that was only a millisecond clock could not tell apart — it handed
    // out one path fifty times and each upload overwrote the last.
    const paths = new Set<string>()
    for (let at = 0; at < 50; at++) {
      paths.add((await store.put('x.db', new Uint8Array([at]))).path)
    }
    expect(paths.size).toBe(50)
  })

  test('sweeps what it replaced, so the directory does not grow', async () => {
    for (let at = 0; at < 4; at++) {
      await store.put('x.db', new Uint8Array([at]))
    }
    expect(await staged()).toHaveLength(1)
  })

  test('recovers the newest after a restart, and forgets everything on clear', async () => {
    // Both inside one millisecond, so this covers the ordering `recover` needs
    // rather than waiting for the clock to supply it.
    await store.put('old.db', new Uint8Array([1]))
    const newest = await store.put('new.db', new Uint8Array([2, 2]))

    const restarted = new SourceStore(tempDir)
    expect(restarted.current()).toBeNull()
    expect((await restarted.recover())?.path).toBe(newest.path)

    await restarted.clear()
    expect(restarted.current()).toBeNull()
    expect(await staged()).toHaveLength(0)
  })

  test('a directory it cannot write says which, and says what to set', async () => {
    const blocked = new SourceStore(path.join(tempDir, 'a.db', 'nested'))
    await fs.writeFile(path.join(tempDir, 'a.db'), 'not a directory')
    await expect(blocked.put('x.db', new Uint8Array([1]))).rejects.toThrow(/work_dir/)
  })

  test('require() says what to do rather than throwing a path error later', () => {
    expect(() => store.require()).toThrow(/no Strapi database has been uploaded/)
  })
})
