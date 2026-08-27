import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { ImportPlans } from './import-plan'
import { MediaLibrary } from './media-library'
import { MultipartBody } from './multipart-body'
import { SourceStore } from './source-store'
import { StrapiDatabase } from './strapi-database'
import { StrapiInventory } from './strapi-inventory'
import { StrapiMedia } from './strapi-media'
import { StrapiRows } from './strapi-rows'
import { UploadStore } from './upload-store'

/**
 * A minimal Strapi 5 database, built to carry the two traps that make this
 * importer non-trivial.
 *
 * Synthetic rather than a fixture file, because what is being pinned is not a
 * particular export — it is the *shape* Strapi produces, and a shape is clearer
 * as thirty lines of SQL than as a megabyte of binary nobody can read in a diff.
 *
 * Trap one: **two document versions**, draft and published, each owning its own
 * copy of the component rows. Trap two: a component table whose name is a
 * *pluralised* form of its uid that no prefix match reaches —
 * `org-quicko.payment-entity` → `components_org_quicko_payment_entities`.
 */
function writeStrapiDatabase(file: string): void {
  const db = new Database(file, { create: true })

  db.run(`CREATE TABLE strapi_core_store_settings (id INTEGER PRIMARY KEY, key TEXT, value TEXT)`)
  db.run(`CREATE TABLE files (
    id INTEGER PRIMARY KEY, name TEXT, alternative_text TEXT, width INTEGER, height INTEGER,
    mime TEXT, size REAL, url TEXT)`)
  db.run(`CREATE TABLE files_related_mph (
    id INTEGER PRIMARY KEY, file_id INTEGER, related_id INTEGER, related_type TEXT,
    field TEXT, "order" REAL)`)

  // The content type: a single type with draft-and-publish, holding one
  // repeatable component list.
  db.run(`CREATE TABLE org_quicko_payment_entities (
    id INTEGER PRIMARY KEY, document_id TEXT, created_at DATETIME, updated_at DATETIME,
    published_at DATETIME, locale TEXT)`)
  db.run(`INSERT INTO org_quicko_payment_entities (id, document_id, published_at)
          VALUES (1, 'doc1', NULL), (2, 'doc1', 1751022409249)`)

  // The component's own table, named the way Strapi's pluraliser names it.
  db.run(`CREATE TABLE components_org_quicko_payment_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_name VARCHAR(255), entity_type VARCHAR(255))`)
  db.run(`CREATE TABLE org_quicko_payment_entities_cmps (
    id INTEGER PRIMARY KEY, entity_id INTEGER, cmp_id INTEGER, component_type TEXT,
    field TEXT, "order" REAL)`)

  // Two logical items, four component rows: the draft copy and the published
  // copy, exactly as Strapi 5 stores them.
  const names: [string, string][] = [
    ['Mastercard', 'card'],
    ['Visa', 'card'],
  ]
  let cmp = 0
  for (const entity of [1, 2]) {
    for (const [index, [name, kind]] of names.entries()) {
      cmp++
      db.run(`INSERT INTO components_org_quicko_payment_entities (id, entity_name, entity_type)
              VALUES (?, ?, ?)`, [cmp, name, kind])
      db.run(`INSERT INTO org_quicko_payment_entities_cmps
                (entity_id, cmp_id, component_type, field, "order")
              VALUES (?, ?, 'org-quicko.payment-entity', 'items', ?)`, [entity, cmp, index + 1])
    }
  }

  // One icon, on the published copy's second row (cmp 4).
  // The `url` carries Strapi's content hash and `name` does not, which is why the
  // importer keys on the basename of `url`: two `visa.svg` uploads share a `name`
  // and never share a `url`.
  db.run(`INSERT INTO files (id, name, mime, size, url, width, height)
          VALUES (1, 'visa.svg', 'image/svg+xml', 2.5, '/uploads/visa_0a2d4ecc.svg', 24, 24)`)
  // The same file on both component rows of the published copy: one asset, two
  // fields, which is the shape `MediaLibrary`'s cache exists for.
  db.run(`INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
          VALUES (1, 4, 'org-quicko.payment-entity', 'entity_icon', 1),
                 (1, 3, 'org-quicko.payment-entity', 'entity_icon', 1)`)

  db.run(`INSERT INTO strapi_core_store_settings (key, value) VALUES ('strapi_content_types_schema', ?)`, [
    JSON.stringify({
      'api::org-quicko-payment-entity.org-quicko-payment-entity': {
        kind: 'singleType',
        collectionName: 'org_quicko_payment_entities',
        info: { displayName: 'Payment entity' },
        options: { draftAndPublish: true },
        __schema__: {
          attributes: {
            items: { type: 'component', component: 'org-quicko.payment-entity', repeatable: true },
          },
        },
      },
      // Dropped: Strapi's own machinery, which silo has no concepts for.
      'plugin::upload.file': { kind: 'collectionType', collectionName: 'files' },
    }),
  ])
  db.close(true)
}

describe('reading a Strapi export', () => {
  let tempDir: string
  let file: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'strapi-import-test-'))
    file = path.join(tempDir, 'data.db')
    writeStrapiDatabase(file)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  /**
   * **The rule this importer is correct or wrong by.**
   *
   * There are four rows in `components_…` and two items. Reading the component
   * table directly gives four, and the failure is silent: no error, no duplicate
   * id, just twice as much content. Both numbers are asserted — the count the
   * plan shows and the rows the import writes — because a version rule applied in
   * one place and not the other is the same bug wearing a correct-looking plan.
   */
  test('counts and reads one document version, not both copies', () => {
    const source = StrapiDatabase.open(file)
    try {
      expect(source.count('components_org_quicko_payment_entities')).toBe(4)

      for (const version of ['published', 'draft'] as const) {
        const inventory = StrapiInventory.read(source, version)
        expect(inventory.lists).toHaveLength(1)
        expect(inventory.lists[0]!.count).toBe(2)

        const rows = StrapiRows.read(source, inventory.lists[0]!, version)
        expect(rows).toHaveLength(2)
        expect(rows.map((row) => row.entry.entity_name)).toEqual(['Mastercard', 'Visa'])
      }
    } finally {
      source.close()
    }
  })

  /** `org-quicko.payment-entity` → `components_org_quicko_payment_entities`: the
   *  y→ies plural no prefix match reaches, and the case that made the first live
   *  run drop a content type with a misleading reason. */
  test('resolves a component table whose plural is not a prefix of its uid', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      expect(inventory.lists[0]!.table).toBe('components_org_quicko_payment_entities')
      expect(inventory.skipped).toEqual([])
    } finally {
      source.close()
    }
  })

  /**
   * **The schema is silo's media type, not a copy of Strapi's.**
   *
   * The importer used to emit an object mirroring Strapi's media shape, and every
   * one of silo's media behaviours passed it by: the admin rendered a nested form
   * instead of the picker, `MediaRefs.extract` found no reference so nothing
   * counted as a usage, and a read never rewrote the URL. Faithful to the source
   * and inert in the destination — which is why the keyword is asserted here
   * rather than left to the one live run that would have shown it.
   */
  test('a media field is x-silo-type media on a string, and carries no Strapi id', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const list = inventory.lists[0]!
      expect(list.media.map((field) => field.name)).toEqual(['entity_icon'])

      const schema = StrapiInventory.schemaFor(list) as any
      expect(schema.properties.entity_icon).toMatchObject({
        type: ['string', 'null'],
        'x-silo-type': 'media',
      })
      // Silo mints its own identity, so nothing of Strapi's is carried.
      expect(schema.properties.strapi_id).toBeUndefined()
      expect(schema.properties.document_id).toBeUndefined()
      expect(schema.properties.entity_name).toEqual({ type: ['string', 'null'] })
    } finally {
      source.close()
    }
  })

  test('media reaches the row as files keyed on the name Strapi wrote to disk', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const list = inventory.lists[0]!
      const rows = StrapiRows.read(source, list, 'published')

      // The basename of `url`, hash and all — the string an operator's uploads
      // directory listing actually holds.
      expect(rows[1]!.media.entity_icon![0]).toMatchObject({
        name: 'visa_0a2d4ecc.svg',
        url: '/uploads/visa_0a2d4ecc.svg',
        mime: 'image/svg+xml',
        // Strapi records kilobytes; every other size in silo is bytes.
        bytes: 2560,
      })
      // The scalar half of the entry holds no media at all: filling a media field
      // means uploading bytes, and a database read has no business awaiting that.
      expect(rows[1]!.entry.entity_icon).toBeUndefined()
    } finally {
      source.close()
    }
  })

  /** One file on two fields is **one** thing to ask the operator for. */
  test('the wanted-file list is deduplicated and scoped to the lists found', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const owners = StrapiInventory.ownersOf(inventory)
      expect(owners).toEqual(['org-quicko.payment-entity'])

      const wanted = StrapiMedia.wantedBy(source, owners)
      expect(wanted.map((file) => file.name)).toEqual(['visa_0a2d4ecc.svg'])
      // Nothing is wanted for an owner this import does not cover.
      expect(StrapiMedia.wantedBy(source, ['api::other.other'])).toEqual([])
    } finally {
      source.close()
    }
  })

  test('refuses a file that is not a Strapi database, saying which', () => {
    const other = path.join(tempDir, 'not-strapi.db')
    const db = new Database(other, { create: true })
    db.run('CREATE TABLE things (id INTEGER PRIMARY KEY)')
    db.close(true)

    expect(() => StrapiDatabase.open(other)).toThrow(/not a Strapi database/)
    expect(() => StrapiDatabase.open(path.join(tempDir, 'nope.db'))).toThrow(/could not be opened/)
  })

  test('the proposed plan names the component, not the wrapper single type', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const plan = ImportPlans.propose(inventory, {
        project: 'default',
        env: 'prod',
        prefix: 'strapi_',
        mediaBaseUrl: '',
        mediaFolder: 'strapi',
      })
      // `payment_entity`, from `org-quicko.payment-entity` — the thing being
      // imported — rather than from the single type Strapi wraps it in.
      expect(plan.steps[0]!.collection).toBe('strapi_payment_entity')
      // `append`, because a plan that defaults to deleting is a plan somebody
      // runs once without reading.
      expect(plan.steps[0]!.mode).toBe('append')
    } finally {
      source.close()
    }
  })

  describe('what a plan may not say', () => {
    const planFor = (source: StrapiDatabase) => {
      const inventory = StrapiInventory.read(source, 'published')
      return {
        inventory,
        plan: ImportPlans.propose(inventory, {
          project: 'default',
          env: 'prod',
          prefix: '',
          mediaBaseUrl: '',
          mediaFolder: '',
        }),
      }
    }

    test('a list this source does not have, a duplicate target, a stale version', () => {
      const source = StrapiDatabase.open(file)
      try {
        const { inventory, plan } = planFor(source)

        expect(() =>
          ImportPlans.read({ ...plan, steps: [{ ...plan.steps[0]!, list: 'api::gone.gone' }] }, inventory)
        ).toThrow(/names no list in this source/)

        expect(() =>
          ImportPlans.read({ ...plan, steps: [plan.steps[0]!, { ...plan.steps[0]! }] }, inventory)
        ).toThrow(/both write into/)

        // A plan built against one version cannot be run against the other: the
        // counts on it would be somebody else's.
        expect(() => ImportPlans.read({ ...plan, version: 'draft' }, inventory)).toThrow(
          /Re-read the source/
        )

        expect(() =>
          ImportPlans.read({ ...plan, steps: [{ ...plan.steps[0]!, collection: 'Not Valid' }] }, inventory)
        ).toThrow(/not a usable name/)

        expect(() =>
          ImportPlans.read({ ...plan, steps: [{ ...plan.steps[0]!, include: false }] }, inventory)
        ).toThrow(/nothing to import/)
      } finally {
        source.close()
      }
    })
  })
})

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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'strapi-store-test-'))
    store = new SourceStore(tempDir)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
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

  test('sweeps what it replaced, so the directory does not grow', async () => {
    for (let at = 0; at < 4; at++) {
      await store.put('x.db', new Uint8Array([at]))
      // Distinct names come from a millisecond clock, so two writes inside one
      // tick would collide — which the sweep would then delete out from under
      // the current source.
      await Bun.sleep(2)
    }
    expect(await staged()).toHaveLength(1)
  })

  test('recovers the newest after a restart, and forgets everything on clear', async () => {
    await store.put('old.db', new Uint8Array([1]))
    await Bun.sleep(2)
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'strapi-uploads-test-'))
    store = new UploadStore(tempDir)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
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

/**
 * The multipart encoder.
 *
 * Asserted by **parsing it back with the platform's own parser** rather than by
 * comparing bytes to a fixture: what matters is that `POST /api/media` — which
 * reads `parseBody()` — sees a `file` field, and a byte-for-byte expectation
 * would pass while being unparseable.
 */
describe('encoding an upload as multipart', () => {
  test('a file part and a field part both arrive as the server reads them', async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    const built = MultipartBody.build([
      { name: 'file', filename: 'logo_a1b2.svg', contentType: 'image/svg+xml', value: bytes },
      { name: 'folder', value: 'strapi' },
    ])

    const form = await new Request('http://silo.invalid/api/media', {
      method: 'POST',
      headers: { 'content-type': built.contentType },
      // Cast because this file is typechecked with both `lib.dom` and Bun's
      // types, and the two disagree about whether a `Uint8Array` is a `BodyInit`.
      body: built.bytes as unknown as BodyInit,
    }).formData()

    const file = form.get('file') as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('logo_a1b2.svg')
    expect(file.type).toBe('image/svg+xml')
    // Binary, not text: an SVG survives either way, a PNG only survives this.
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(form.get('folder')).toBe('strapi')
  })

  test('a quote in a filename cannot end the header early', async () => {
    const built = MultipartBody.build([
      { name: 'file', filename: 'a"; name="folder', contentType: 'text/plain', value: 'x' },
    ])
    const form = await new Request('http://silo.invalid/api/media', {
      method: 'POST',
      headers: { 'content-type': built.contentType },
      body: built.bytes as unknown as BodyInit,
    }).formData()
    expect(form.get('folder')).toBeNull()
    expect(form.get('file')).toBeInstanceOf(File)
  })
})

/**
 * Turning a Strapi file into a silo media reference.
 *
 * The three outcomes an operator can actually get, each pinned: the file was
 * supplied, the file was not, and the plugin was never granted `media:create`.
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

  /** A `ctx` that is only ever asked for `fetch`, which is all `MediaLibrary`
   *  uses — so the fake is the whole surface rather than a stub of it. */
  function contextAnswering(answer: (path: string, init: any) => any) {
    const calls: { path: string; init: any }[] = []
    const ctx = {
      fetch: async (path: string, init: any) => {
        calls.push({ path, init })
        return answer(path, init)
      },
    } as any
    return { ctx, calls }
  }

  function answer(status: number, body: unknown) {
    const text = JSON.stringify(body)
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {},
      bytes: new TextEncoder().encode(text),
      text: () => text,
      json: () => body,
    }
  }

  const staged = (bytes: Uint8Array | null) =>
    ({ read: async () => bytes }) as any

  /** The catalog listing `existing` makes before uploading, answering "nothing
   *  like it here" — the state of a first import. */
  const nothingLikeIt = answer(200, { items: [] })

  test('a supplied file is uploaded once and reused, however many fields point at it', async () => {
    const { ctx, calls } = contextAnswering((path, init) =>
      init?.method === 'POST' ? answer(201, { id: '01J8XQ4Z8K9M2P3R5T7V9X1B3D' }) : nothingLikeIt,
    )
    const library = new MediaLibrary({
      ctx,
      uploads: staged(new Uint8Array([1, 2, 3])),
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
    // lookup, one upload, and the second field served from the cache.
    expect(calls.map((call) => call.init?.method ?? 'GET')).toEqual(['GET', 'POST'])
    expect(calls[1]!.path).toBe('/api/media')
    expect(library.result()).toMatchObject({ uploaded: 1, matched: 0, reused: 1, kept: 0, bytes: 3 })
  })

  test('an unsupplied file keeps its Strapi URL, in the same field of the same schema', async () => {
    const { ctx, calls } = contextAnswering(() => answer(201, { id: 'unused' }))
    // No bytes, so nothing is even looked up: the calls below stay at zero.
    const library = new MediaLibrary({
      ctx,
      uploads: staged(null),
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

    const { ctx, calls } = contextAnswering((path, init) =>
      init?.method === 'POST'
        ? answer(201, { id: 'should-not-happen' })
        : answer(200, {
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
      uploads: staged(bytes),
      folder: 'strapi',
      baseUrl: 'https://cms.example.com',
    })

    const entry: Record<string, unknown> = {}
    await library.attach(entry, list, { entity_icon: [file] })

    expect(entry.entity_icon).toBe('silo://media/01J8XQ50P1R2S3T4U5V6W7X8Y9')
    expect(calls.map((call) => call.init?.method ?? 'GET')).toEqual(['GET'])
    expect(calls[0]!.path).toContain('folder=strapi')
    expect(library.result()).toMatchObject({ uploaded: 0, matched: 1, bytes: 0 })
  })

  /** `media:read` is optional too, and its absence costs one request rather than
   *  one per file — the import still runs, and still uploads. */
  test('a refused media:read stops the lookups and uploads anyway', async () => {
    const { ctx, calls } = contextAnswering((path, init) =>
      init?.method === 'POST'
        ? answer(201, { id: '01J8XQ4Z8K9M2P3R5T7V9X1B3D' })
        : answer(403, { error: { code: 'forbidden', message: 'no' } }),
    )
    const library = new MediaLibrary({
      ctx,
      uploads: staged(new Uint8Array([1])),
      folder: '',
      baseUrl: '',
    })

    for (const name of ['a.svg', 'b.svg']) {
      const entry: Record<string, unknown> = {}
      await library.attach(entry, list, { entity_icon: [{ ...file, name, url: '/uploads/' + name }] })
      expect(String(entry.entity_icon)).toStartWith('silo://media/')
    }

    // One refused lookup, then two uploads — not a refused lookup per file.
    expect(calls.map((call) => call.init?.method ?? 'GET')).toEqual(['GET', 'POST', 'POST'])
    expect(library.result()).toMatchObject({ uploaded: 2, matched: 0 })
  })

  /**
   * `media:create` is optional, so this is an ordinary state rather than an edge
   * case. A 403 is read as an **answer**: stop uploading, say so once, keep the
   * URLs — the alternative is one refused request per file and an import that
   * reports nothing an operator could act on.
   */
  test('a refused media:create stops uploading and says so once', async () => {
    const { ctx, calls } = contextAnswering((path, init) =>
      init?.method === 'POST'
        ? answer(403, { error: { code: 'forbidden', message: 'no' } })
        : nothingLikeIt,
    )
    const library = new MediaLibrary({
      ctx,
      uploads: staged(new Uint8Array([1])),
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
