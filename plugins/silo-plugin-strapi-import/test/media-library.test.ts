import { describe, test, expect } from 'bun:test'
import { createHash } from 'crypto'
import { MediaLibrary } from '../src/silo/media-library'
import { FakeSilo } from './support/fake-silo'

/**
 * Turning a Strapi file into a silo media reference.
 *
 * The outcomes an operator can actually get, each pinned: the file was supplied,
 * the file was not, silo already held it, and the plugin was never granted
 * `media:create`.
 */
describe('media becoming silo media', () => {
  const list = {
    media: [{ name: 'entity_icon', multiple: false, rows: 1 }],
  } as any

  const file = {
    name: 'visa_0a2d4ecc.svg',
    url: '/uploads/visa_0a2d4ecc.svg',
    mime: 'image/svg+xml',
    bytes: 2560,
  }

  /** The catalog listing `existing` makes before uploading, answering "nothing
   *  like it here" — the state of a first import. */
  const nothingLikeIt = FakeSilo.answer(200, { items: [] })

  test('a supplied file is uploaded once and reused, however many fields point at it', async () => {
    const { ctx, calls } = FakeSilo.context((_path, init) =>
      init?.method === 'POST'
        ? FakeSilo.answer(201, { id: '01J8XQ4Z8K9M2P3R5T7V9X1B3D' })
        : nothingLikeIt,
    )
    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(new Uint8Array([1, 2, 3])),
      folder: 'strapi',
      baseUrl: 'https://cms.example.com',
    })

    const first: Record<string, unknown> = {}
    const second: Record<string, unknown> = {}
    await library.attach(first, list, { entity_icon: [file] })
    await library.attach(second, list, { entity_icon: [file] })

    // A real reference, which is the whole point: the picker renders it, a delete
    // counts the usage, and a read rewrites it against whatever host answered.
    expect(first.entity_icon).toBe('silo://media/01J8XQ4Z8K9M2P3R5T7V9X1B3D')
    expect(second.entity_icon).toBe(first.entity_icon)

    // 251 rows carrying the same flag is one asset, not 251 identical blobs: one
    // lookup, one folder, one upload, and the second field served from the cache.
    expect(calls.map((call) => call.path.split('?')[0])).toEqual([
      '/api/media',
      '/api/media/folders',
      '/api/media',
    ])
    expect(FakeSilo.methods(calls)).toEqual(['GET', 'POST', 'POST'])
    expect(library.result()).toMatchObject({ uploaded: 1, matched: 0, reused: 1, kept: 0, bytes: 3 })
  })

  /**
   * **The configured folder is made, not merely named.**
   *
   * `folder` on the upload puts the file in the right place either way, since an
   * asset naming a folder implies it exists. What the explicit record adds is a
   * folder the operator can see in the library tree from the first import, and
   * one that survives every file in it being deleted.
   *
   * Once per run: a per-file declaration would be one redundant request for every
   * upload, and the same folder however many files land in it.
   */
  test('the configured folder is declared once, before the first file goes in', async () => {
    const { ctx, calls } = FakeSilo.context((path, init) =>
      init?.method === 'POST'
        ? FakeSilo.answer(201, path === '/api/media/folders' ? { path: '/strapi' } : { id: 'a1' })
        : nothingLikeIt,
    )
    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(new Uint8Array([1])),
      folder: 'strapi',
      baseUrl: '',
    })

    for (const name of ['a.svg', 'b.svg']) {
      await library.attach({}, list, { entity_icon: [{ ...file, name, url: `/uploads/${name}` }] })
    }

    const folders = calls.filter((call) => call.path === '/api/media/folders')
    expect(folders).toHaveLength(1)
    expect(JSON.parse(folders[0]!.init.body)).toEqual({ path: 'strapi' })
    // Before the upload it is for, not after it.
    expect(calls.indexOf(folders[0]!)).toBeLessThan(
      calls.findIndex((call) => call.path === '/api/media'),
    )
  })

  /** No folder configured means the library root, and nothing to declare. */
  test('an empty folder declares nothing', async () => {
    const { ctx, calls } = FakeSilo.context((_path, init) =>
      init?.method === 'POST' ? FakeSilo.answer(201, { id: 'a1' }) : nothingLikeIt,
    )
    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(new Uint8Array([1])),
      folder: '',
      baseUrl: '',
    })

    await library.attach({}, list, { entity_icon: [file] })
    expect(calls.some((call) => call.path === '/api/media/folders')).toBe(false)
  })

  test('an unsupplied file keeps its Strapi URL, in the same field of the same schema', async () => {
    const { ctx, calls } = FakeSilo.context(() => FakeSilo.answer(201, { id: 'unused' }))
    // No bytes, so nothing is even looked up: the calls below stay at zero.
    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(null),
      folder: '',
      baseUrl: 'https://cms.example.com/',
    })

    const entry: Record<string, unknown> = {}
    await library.attach(entry, list, { entity_icon: [file] })

    // Silo resolves a foreign URL by leaving it alone, so this is a media value
    // and not a broken one — which is what lets an operator import now and send
    // the files later with no schema change in between.
    expect(entry.entity_icon).toBe('https://cms.example.com/uploads/visa_0a2d4ecc.svg')
    expect(calls).toHaveLength(0)
    expect(library.result()).toMatchObject({ uploaded: 0, kept: 1 })

    // No file at all is `null`, not absent.
    const empty: Record<string, unknown> = {}
    await library.attach(empty, list, {})
    expect(empty.entity_icon).toBeNull()
  })

  /**
   * **What makes a re-import idempotent.**
   *
   * `POST /api/media` mints a new id per request and deduplicates nothing, so
   * without this a `replace` re-run doubles the library and orphans the previous
   * copies — measured that way on a live re-run. Matched on silo's own sha256 and
   * not on the filename: Strapi's content hash in a name is a convention, a digest
   * is a fact.
   */
  test('a file silo already holds byte for byte is matched, not uploaded again', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const digest = createHash('sha256').update(bytes).digest('hex')

    const { ctx, calls } = FakeSilo.context((_path, init) =>
      init?.method === 'POST'
        ? FakeSilo.answer(201, { id: 'should-not-happen' })
        : FakeSilo.answer(200, {
            items: [
              // Same name, different bytes: not a match, which is the case a
              // filename comparison would get wrong.
              { id: 'other', filename: file.name, hash: 'deadbeef' },
              { id: '01J8XQ50P1R2S3T4U5V6W7X8Y9', filename: file.name, hash: digest },
            ],
          }),
    )

    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(bytes),
      folder: 'strapi',
      baseUrl: 'https://cms.example.com',
    })

    const entry: Record<string, unknown> = {}
    await library.attach(entry, list, { entity_icon: [file] })

    expect(entry.entity_icon).toBe('silo://media/01J8XQ50P1R2S3T4U5V6W7X8Y9')
    // Nothing was uploaded, so nothing needed a folder either.
    expect(FakeSilo.methods(calls)).toEqual(['GET'])
    expect(calls[0]!.path).toContain('folder=strapi')
    expect(library.result()).toMatchObject({ uploaded: 0, matched: 1, bytes: 0 })
  })

  /** `media:read` is optional too, and its absence costs one request rather than
   *  one per file — the import still runs, and still uploads. */
  test('a refused media:read stops the lookups and uploads anyway', async () => {
    const { ctx, calls } = FakeSilo.context((_path, init) =>
      init?.method === 'POST'
        ? FakeSilo.answer(201, { id: '01J8XQ4Z8K9M2P3R5T7V9X1B3D' })
        : FakeSilo.answer(403, { error: { code: 'forbidden', message: 'no' } }),
    )
    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(new Uint8Array([1])),
      folder: '',
      baseUrl: '',
    })

    for (const name of ['a.svg', 'b.svg']) {
      const entry: Record<string, unknown> = {}
      await library.attach(entry, list, { entity_icon: [{ ...file, name, url: '/uploads/' + name }] })
      expect(String(entry.entity_icon)).toStartWith('silo://media/')
    }

    // One refused lookup, then two uploads — not a refused lookup per file.
    expect(FakeSilo.methods(calls)).toEqual(['GET', 'POST', 'POST'])
    expect(library.result()).toMatchObject({ uploaded: 2, matched: 0 })
  })

  /**
   * `media:create` is optional, so this is an ordinary state rather than an edge
   * case. A 403 is read as an **answer**: stop uploading, say so once, keep the
   * URLs — the alternative is one refused request per file and an import that
   * reports nothing an operator could act on.
   */
  test('a refused media:create stops uploading and says so once', async () => {
    const { ctx, calls } = FakeSilo.context((_path, init) =>
      init?.method === 'POST'
        ? FakeSilo.answer(403, { error: { code: 'forbidden', message: 'no' } })
        : nothingLikeIt,
    )
    const library = new MediaLibrary({
      ctx,
      uploads: FakeSilo.uploads(new Uint8Array([1])),
      folder: '',
      baseUrl: 'https://cms.example.com',
    })

    for (const _ of [1, 2, 3]) {
      const entry: Record<string, unknown> = {}
      await library.attach(entry, list, { entity_icon: [file] })
      expect(entry.entity_icon).toBe('https://cms.example.com/uploads/visa_0a2d4ecc.svg')
    }

    // One lookup and one refused upload, then nothing: a per-file 403 would be
    // three hundred refused requests and an import reporting nothing useful.
    expect(calls).toHaveLength(2)
    const result = library.result()
    expect(result.stopped).toMatch(/media:create/)
    expect(result).toMatchObject({ uploaded: 0, matched: 0, kept: 3 })
  })
})
