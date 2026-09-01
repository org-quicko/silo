import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs/promises'
import path from 'path'
import { UploadStore } from '../src/staging/upload-store'
import { TempDirectory } from './support/temp-directory'

/**
 * Staging Strapi's uploads.
 *
 * The transport that makes silo's media type reachable at all: without the bytes,
 * a media field can only ever hold a URL pointing back at the instance being
 * migrated off.
 */
describe('staging Strapi uploads', () => {
  let tempDir: string
  let store: UploadStore

  beforeEach(async () => {
    tempDir = await TempDirectory.make('strapi-uploads-test')
    store = new UploadStore(tempDir)
  })

  afterEach(async () => {
    await TempDirectory.remove(tempDir)
  })

  test('a file goes in, comes back, and shows up in the index', async () => {
    expect(await store.read('logo_a1b2.svg')).toBeNull()
    expect((await store.index()).size).toBe(0)

    await store.put('logo_a1b2.svg', new Uint8Array([1, 2, 3]))
    expect(await store.read('logo_a1b2.svg')).toEqual(new Uint8Array([1, 2, 3]))
    expect(await store.index()).toEqual(new Map([['logo_a1b2.svg', 3]]))

    // Overwritten in place, which is what keeps this free of the Windows file
    // locking `SourceStore` has to work around: no rename, no delete.
    await store.put('logo_a1b2.svg', new Uint8Array([9]))
    expect(await store.read('logo_a1b2.svg')).toEqual(new Uint8Array([9]))

    await store.clear()
    expect((await store.index()).size).toBe(0)
  })

  /**
   * **Refused, not sanitised.** The name reaches `path.join`, so it has to be
   * checked; a `..` quietly rewritten would stage the file under a name the import
   * then looks for and does not find, and the operator would see "not supplied"
   * for a file they watched upload.
   */
  test('a name that is a path is refused, saying what a name looks like', () => {
    for (const bad of ['../escape.svg', 'a/b.svg', 'a\\b.svg', 'c:evil.svg', '..', '.', '', '   ']) {
      expect(() => UploadStore.filename(bad)).toThrow()
    }
    expect(() => UploadStore.filename('../escape.svg')).toThrow(/not a plain filename/)
    expect(UploadStore.filename('  logo_a1b2.svg  ')).toBe('logo_a1b2.svg')
  })

  test('a name the store could never have staged reads as "not here", not as a throw', async () => {
    // Reached from the import rather than from a route: a catalog row naming
    // something odd is a file that was not supplied, not a failed import.
    expect(await store.read('../../etc/passwd')).toBeNull()
  })

  test('a directory it cannot write says which, and says what to set', async () => {
    await fs.writeFile(path.join(tempDir, 'blocked'), 'not a directory')
    const blocked = new UploadStore(path.join(tempDir, 'blocked'))
    await expect(blocked.put('x.svg', new Uint8Array([1]))).rejects.toThrow(/work_dir/)
  })
})
