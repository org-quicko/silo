import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { ImportPlans } from './import-plan'
import { SourceStore } from './source-store'
import { StrapiDatabase } from './strapi-database'
import { StrapiInventory } from './strapi-inventory'
import { StrapiRows } from './strapi-rows'

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
  db.run(`INSERT INTO files (id, name, mime, size, url, width, height)
          VALUES (1, 'visa.svg', 'image/svg+xml', 2.5, '/uploads/visa.svg', 24, 24)`)
  db.run(`INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
          VALUES (1, 4, 'org-quicko.payment-entity', 'entity_icon', 1)`)

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

        const rows = StrapiRows.read(source, inventory.lists[0]!, version, '')
        expect(rows).toHaveLength(2)
        expect(rows.map((row) => row.entity_name)).toEqual(['Mastercard', 'Visa'])
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

  test('carries media as a URL, absolutised, and null where there is none', () => {
    const source = StrapiDatabase.open(file)
    try {
      const inventory = StrapiInventory.read(source, 'published')
      const list = inventory.lists[0]!
      expect(list.media.map((field) => field.name)).toEqual(['entity_icon'])

      const rows = StrapiRows.read(source, list, 'published', 'https://cms.example.com/')
      // The icon is on the published copy's second row.
      expect(rows[1]!.entity_icon).toMatchObject({
        url: 'https://cms.example.com/uploads/visa.svg',
        mime: 'image/svg+xml',
        // Strapi records kilobytes; every other size in silo is bytes.
        size: 2560,
      })
      // Absent is `null`, not missing: a cleared field and an absent key read the
      // same to every consumer, and only one of them is what the source says.
      expect(rows[0]!.entity_icon).toBeNull()
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
