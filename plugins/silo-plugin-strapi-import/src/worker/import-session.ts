import fs from 'fs/promises'
import type { SiloContext } from 'silo:api'
import { ImportJobs } from '../import/import-jobs'
import { SourceStore } from '../staging/source-store'
import { UploadStore } from '../staging/upload-store'
import { StrapiDatabase } from '../strapi/strapi-database'
import type { StrapiInventory as Inventory } from '../strapi/strapi-inventory'
import { StrapiInventory } from '../strapi/strapi-inventory'
import type { PluginSettings } from './plugin-settings'

/**
 * One operator's import: the database they staged, the uploads they sent, the
 * inventory read from it, and the jobs they have run.
 *
 * All of this was one set of fields on `ImportRuntime`, which made it one slot
 * for the whole instance — a second operator's upload swept the first one's file
 * and their plan was then validated against a database they had never seen. It
 * is keyed per caller instead; `ImportSessions` owns the key and the lifetime.
 */
export class ImportSession {
  readonly key: string
  /** The caller's own label, for the panel and for an operator reading the
   *  staging directory. Never a credential. */
  readonly label: string
  readonly directory: string
  readonly store: SourceStore
  readonly uploads: UploadStore
  readonly jobs: ImportJobs

  private readonly settings: PluginSettings
  private cached: Inventory | null = null
  private sequence = 0
  private touchedAt: number

  constructor(options: {
    key: string
    label: string
    directory: string
    settings: PluginSettings
    touchedAt?: number
  }) {
    this.key = options.key
    this.label = options.label
    this.directory = options.directory
    this.settings = options.settings
    this.touchedAt = options.touchedAt ?? Date.now()
    this.store = new SourceStore(options.directory)
    this.uploads = new UploadStore(options.directory)
    this.jobs = new ImportJobs()
  }

  /** The inventory, re-reading the source if this session has not seen it yet. */
  inventory(ctx: SiloContext): Inventory {
    if (this.cached && this.cached.version === this.settings.version) return this.cached
    return this.read(ctx)
  }

  /** Read the staged source and cache what is in it. */
  read(ctx: SiloContext): Inventory {
    const staged = this.store.require()
    const inventory = this.withSource((source) =>
      StrapiInventory.read(source, this.settings.version),
    )
    this.cached = inventory
    ctx.log.info('read a Strapi source', {
      session: this.key,
      file: staged.name,
      lists: inventory.lists.length,
      skipped: inventory.skipped.length,
    })
    return inventory
  }

  /** Drop the cached inventory, so the next read goes back to the file. */
  forget(): void {
    this.cached = null
  }

  /**
   * Run `read` against the staged database, and close the handle before
   * returning.
   *
   * Not held open for the next request: a read-only handle on a staged file is
   * cheap to reopen and expensive to leak — the operator may delete the source
   * between two requests, and on Windows an open handle is what makes that fail.
   */
  withSource<T>(read: (source: StrapiDatabase) => T): T {
    const source = StrapiDatabase.open(this.store.require().path)
    try {
      return read(source)
    } finally {
      source.close()
    }
  }

  /** An id for the next import, unique within this session's life. */
  nextJobId(): string {
    return `import-${++this.sequence}-${Date.now().toString(36)}`
  }

  /** Mark the session in use, which is what keeps the janitor off it. */
  touch(): void {
    this.touchedAt = Date.now()
  }

  /** How long since a request last reached it. */
  idleMs(now = Date.now()): number {
    return now - this.touchedAt
  }

  /** Whether an import of this session's is in flight. A busy session is never
   *  swept: the run is still reading the file the sweep would delete. */
  busy(): boolean {
    return this.jobs.current() !== null
  }

  /** Adopt a source staged before a worker restart. */
  async recover(): Promise<void> {
    await this.store.recover()
  }

  /** Delete the whole staging directory. The session is gone with it. */
  async remove(): Promise<void> {
    await fs.rm(this.directory, { recursive: true, force: true }).catch(() => {})
  }
}
