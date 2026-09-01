import type { SiloContext } from 'silo:api'
import { ImportJobs } from '../import/import-jobs'
import { SourceStore } from '../staging/source-store'
import { UploadStore } from '../staging/upload-store'
import { StrapiDatabase } from '../strapi/strapi-database'
import type { StrapiInventory as Inventory } from '../strapi/strapi-inventory'
import { StrapiInventory } from '../strapi/strapi-inventory'
import { PluginSettings } from './plugin-settings'

/**
 * The mutable state one worker holds, built at activation.
 *
 * A single live instance rather than a value threaded through every route,
 * because the routes are keys on one object silo calls and there is nowhere to
 * pass it: `activate` is the only place that runs before them.
 */
export class ImportRuntime {
  private static live: ImportRuntime | null = null

  readonly settings: PluginSettings
  readonly store: SourceStore
  readonly uploads: UploadStore
  readonly jobs: ImportJobs

  /** The inventory of the staged source, read once per upload rather than per
   *  request: it is a dozen queries and the file does not change under us. */
  private cached: Inventory | null = null
  private sequence = 0

  private constructor(settings: PluginSettings) {
    this.settings = settings
    this.store = new SourceStore(settings.workDir)
    this.uploads = new UploadStore(settings.workDir)
    this.jobs = new ImportJobs()
  }

  /**
   * Build the runtime and recover a source staged before a restart.
   *
   * The recovery is the whole reason this plugin declares a runtime: without it,
   * restarting the worker — which the admin offers a button for — would leave the
   * panel reporting no source while a copy of the operator's database sat in the
   * staging directory.
   */
  static async start(ctx: SiloContext): Promise<ImportRuntime> {
    const runtime = new ImportRuntime(PluginSettings.read(ctx))
    ImportRuntime.live = runtime

    const recovered = await runtime.store.recover()
    if (recovered) {
      ctx.log.info('found a Strapi source staged before this start', {
        path: recovered.path,
        bytes: recovered.bytes,
        uploads: (await runtime.uploads.index()).size,
      })
    }
    return runtime
  }

  /** Forget the runtime. The staged file is deliberately left on disk: a restart
   *  is not a decision to discard an operator's upload, and `DELETE /source` is
   *  where that decision is expressed. */
  static stop(): void {
    ImportRuntime.live = null
  }

  static current(): ImportRuntime {
    if (!ImportRuntime.live) throw new Error('the plugin is not activated')
    return ImportRuntime.live
  }

  /** The inventory, re-reading the source if this worker has not seen it yet. */
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

  /** An id for the next import, unique within this worker's life. */
  nextJobId(): string {
    return `import-${++this.sequence}-${Date.now().toString(36)}`
  }
}
