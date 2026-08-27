import type { SiloContext } from 'silo:api'
import type { MediaOutcome } from './media-library'
import { MediaLibrary } from './media-library'
import type { ImportPlan, ImportStep } from './import-plan'
import type { StrapiInventory, StrapiList } from './strapi-inventory'
import { StrapiInventory as Inventory } from './strapi-inventory'
import { StrapiRows } from './strapi-rows'
import { StrapiDatabase } from './strapi-database'
import type { UploadStore } from './upload-store'

export type ImportState = 'running' | 'done' | 'failed'

/** What one step of a running import has done so far. */
export interface ImportStepProgress {
  list: string
  label: string
  collection: string
  mode: ImportStep['mode']
  total: number
  written: number
  failed: number
  state: 'waiting' | 'running' | 'done' | 'skipped' | 'failed'
  /** Why it is skipped or failed, or what it did that is worth saying. */
  detail: string | null
  /** The first few row failures, verbatim. Enough to diagnose a schema
   *  mismatch, and bounded so one bad column cannot make the progress response
   *  megabytes. */
  errors: { row: number; message: string }[]
}

export interface ImportProgress {
  id: string
  state: ImportState
  startedAt: string
  finishedAt: string | null
  plan: ImportPlan
  steps: ImportStepProgress[]
  /** What became of the media of the whole run. One tally rather than one per
   *  step, because one uploaded file commonly serves several collections and the
   *  cache that makes that true is per job. */
  media: MediaOutcome
  /** Set when the whole run failed rather than one step. */
  error: string | null
}

/**
 * One import, running.
 *
 * It runs **off** the route that started it. `POST /imports` answers with a job
 * id immediately and the work continues in the worker, which is not an
 * optimisation: a dispatch is bounded by `timeout_ms` (five seconds by default),
 * and 367 entries each going through validation and the write lock will not fit
 * in it — so a synchronous import would time out, be declared a plugin fault, and
 * take the worker down mid-write.
 *
 * Two consequences of running past its dispatch, both from silo's own contract:
 *
 * - Each `ctx` call gets a **fresh** `timeout_ms` rather than what is left of the
 *   route's, because the host gives an uncorrelated call the full budget —
 *   genuinely uncaused work has no deadline over it (§13.19).
 * - The write carries this plugin's own name in its causal chain, so a plugin that
 *   also declared hooks would not be delivered its own writes (D33, and D41 made
 *   that hold for work that outlives its dispatch).
 *
 * Progress lives in memory and dies with the worker. That is honest for what this
 * is — an operator watching a screen — and the alternative, a silo collection of
 * job records, would mean this plugin writing its own bookkeeping into the
 * instance it is importing into.
 *
 * A run writes **media as well as entries**, which is why `MediaLibrary` is built
 * here and not per step: a supplied upload becomes one asset in silo's library
 * however many rows and collections point at it, and the cache that makes that
 * true has to outlive a step to be worth having.
 */
export class ImportJob {
  readonly id: string
  private readonly plan: ImportPlan
  private readonly sourcePath: string
  private readonly ctx: SiloContext
  private readonly media: MediaLibrary
  private readonly progress: ImportProgress

  constructor(options: {
    id: string
    plan: ImportPlan
    sourcePath: string
    inventory: StrapiInventory
    uploads: UploadStore
    ctx: SiloContext
  }) {
    this.id = options.id
    this.plan = options.plan
    this.sourcePath = options.sourcePath
    this.ctx = options.ctx
    // One library for the whole run, so a flag on 251 rows is one asset in silo's
    // media library rather than 251 identical blobs.
    this.media = new MediaLibrary({
      ctx: options.ctx,
      uploads: options.uploads,
      folder: options.plan.mediaFolder,
      baseUrl: options.plan.mediaBaseUrl,
    })
    this.progress = {
      id: options.id,
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      media: this.media.result(),
      plan: options.plan,
      steps: options.plan.steps.map((step) => {
        const list = options.inventory.lists.find((candidate) => candidate.id === step.list)!
        return {
          list: step.list,
          label: list.label,
          collection: step.collection,
          mode: step.mode,
          total: list.count,
          written: 0,
          failed: 0,
          state: 'waiting',
          detail: null,
          errors: [],
        }
      }),
    }
  }

  /** A snapshot the panel polls. Copied, so a poll mid-write cannot observe a
   *  half-updated step. */
  snapshot(): ImportProgress {
    // Read rather than mirrored on every row: `MediaLibrary` owns the tally, and
    // a copy updated per attachment would be a second place for it to be wrong.
    this.progress.media = this.media.result()
    return structuredClone(this.progress)
  }

  /**
   * Run every step, in plan order.
   *
   * A failing step does not stop the run, and that is the choice worth stating: a
   * six-collection import where the fourth has a bad column should leave the
   * other five imported and say which one failed, because the alternative asks an
   * operator to un-import five collections by hand before retrying. What *does*
   * stop the run is a failure to open the source, which is not about one step.
   */
  async run(): Promise<void> {
    let source: StrapiDatabase
    try {
      source = StrapiDatabase.open(this.sourcePath)
    } catch (caught: any) {
      this.progress.state = 'failed'
      this.progress.error = `the staged source could not be re-opened: ${caught?.message ?? caught}`
      this.progress.finishedAt = new Date().toISOString()
      return
    }

    try {
      const inventory = Inventory.read(source, this.plan.version)
      for (const step of this.progress.steps) {
        const list = inventory.lists.find((candidate) => candidate.id === step.list)
        if (!list) {
          this.finish(step, 'failed', 'this list is no longer in the source')
          continue
        }
        await this.runStep(source, step, list)
      }
      this.progress.state = this.progress.steps.some((step) => step.state === 'failed')
        ? 'failed'
        : 'done'
    } catch (caught: any) {
      this.progress.state = 'failed'
      this.progress.error = caught?.message ?? String(caught)
    } finally {
      source.close()
      this.progress.media = this.media.result()
      this.progress.finishedAt = new Date().toISOString()
    }
  }

  private async runStep(
    source: StrapiDatabase,
    step: ImportStepProgress,
    list: StrapiList,
  ): Promise<void> {
    step.state = 'running'
    const scope = { project: this.plan.project, env: this.plan.env }

    try {
      const existing = await this.prepare(scope, step, list)
      if (existing === 'skip') return

      const rows = StrapiRows.read(source, list, this.plan.version)
      step.total = rows.length

      for (let at = 0; at < rows.length; at++) {
        try {
          const row = rows[at]!
          // Media first, and per row rather than per list: an upload that answers
          // 403 has to stop the *uploading* without stopping the import, and the
          // entry that follows holds whatever value the file actually got.
          await this.media.attach(row.entry, list, row.media)
          await this.ctx.entries.create(scope, step.collection, row.entry)
          step.written++
        } catch (caught: any) {
          step.failed++
          // Bounded at ten. A schema mismatch fails every row identically, and
          // the eleventh copy of the same message is not information.
          if (step.errors.length < 10) {
            step.errors.push({ row: at, message: caught?.message ?? String(caught) })
          }
        }
      }

      this.finish(
        step,
        step.failed > 0 ? 'failed' : 'done',
        step.failed > 0 ? `${step.failed} of ${step.total} rows were refused` : null,
      )
    } catch (caught: any) {
      this.finish(step, 'failed', caught?.message ?? String(caught))
    }
  }

  /**
   * Make the target collection ready, and answer whether to write into it.
   *
   * **Existence is asked, never inferred from the create.** `POST /collections`
   * is an upsert: it answers 201 whether the collection was new or not, and it
   * replaces the schema either way. Reading its status as "created" — which this
   * did on its first live run — made `skip` and `replace` both silently degrade
   * into `append`, and made every re-import overwrite a schema an operator may
   * have edited since. Two failures from one wrong inference, neither of them
   * visible in the result.
   *
   * So the schema is read first, which is what `collections:*&#47;*&#47;*:schema:read`
   * was requested for, and an existing collection's schema is **left alone**.
   */
  private async prepare(
    scope: { project: string; env: string },
    step: ImportStepProgress,
    list: StrapiList,
  ): Promise<'write' | 'skip'> {
    if (!(await this.exists(scope, step.collection))) {
      await this.create(scope, step.collection, Inventory.schemaFor(list))
      step.detail = `created "${step.collection}"`
      return 'write'
    }

    step.detail = `"${step.collection}" already exists — its schema is left as it is`
    if (step.mode === 'append') return 'write'

    const page = await this.ctx.entries.list(scope, step.collection, { limit: 1 })
    if (page.total === 0) return 'write'

    if (step.mode === 'skip') {
      this.finish(step, 'skipped', `"${step.collection}" already holds ${page.total} entries`)
      return 'skip'
    }
    await this.empty(scope, step.collection)
    step.detail = `emptied "${step.collection}" first (${page.total} entries)`
    return 'write'
  }

  /** Whether the collection is already there. A 404 is the answer "the name is
   *  free", not a failure. */
  private async exists(
    scope: { project: string; env: string },
    collection: string,
  ): Promise<boolean> {
    const response = await this.ctx.fetch(
      `${ImportJob.scopePath(scope)}/collections/${encodeURIComponent(collection)}/schema`,
    )
    if (response.status === 404) return false
    if (response.ok) return true
    throw new Error(
      response.json()?.error?.message ??
        `reading "${collection}" answered ${response.status}`,
    )
  }

  private async create(
    scope: { project: string; env: string },
    collection: string,
    schema: Record<string, unknown>,
  ): Promise<void> {
    const response = await this.ctx.fetch(`${ImportJob.scopePath(scope)}/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: collection, schema }),
    })
    if (response.ok) return
    throw new Error(
      response.json()?.error?.message ?? `creating "${collection}" answered ${response.status}`,
    )
  }

  private static scopePath(scope: { project: string; env: string }): string {
    return (
      `/api/projects/${encodeURIComponent(scope.project)}` +
      `/environments/${encodeURIComponent(scope.env)}`
    )
  }

  /** Delete every entry in a collection, a page at a time. */
  private async empty(scope: { project: string; env: string }, collection: string): Promise<void> {
    for (;;) {
      const page = await this.ctx.entries.list(scope, collection, { limit: 100 })
      if (page.data.length === 0) return
      for (const entry of page.data) {
        await this.ctx.entries.delete(scope, collection, entry.id, entry.rev)
      }
    }
  }

  private finish(step: ImportStepProgress, state: ImportStepProgress['state'], detail: string | null): void {
    step.state = state
    if (detail !== null) step.detail = detail
  }
}
