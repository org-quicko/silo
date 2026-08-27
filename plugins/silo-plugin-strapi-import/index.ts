import { defineSiloPlugin, ValidationError } from 'silo:api'
import type { SiloContext, SiloRequest } from 'silo:api'
import { ImportJob } from './import-job'
import { ImportJobs } from './import-jobs'
import { ImportPlans } from './import-plan'
import { SourceStore } from './source-store'
import { StrapiDatabase } from './strapi-database'
import type { StrapiInventory as Inventory } from './strapi-inventory'
import { StrapiInventory } from './strapi-inventory'
import { StrapiMedia } from './strapi-media'
import { StrapiVersions } from './strapi-versions'
import type { StrapiVersion } from './strapi-versions'
import { UploadStore } from './upload-store'

/**
 * Import a Strapi 5 SQLite export into silo collections.
 *
 * The flow the panel drives, and the reason each step is its own route:
 *
 * 1. `POST /source` takes the `.db` as **bytes** and answers with what is in it.
 *    This is the route that could not exist before D41 — a plugin route decoded
 *    every body as text and capped it at one mebibyte, so a plugin whose job is
 *    reading a file had no way to be handed one.
 * 2. `GET /files` says which uploads the import wants and which have arrived, and
 *    `POST /files` takes one file's bytes. **One file per request, not an
 *    archive**: the 64 MiB body ceiling is per request, and a real instance's
 *    uploads directory is routinely bigger than that, so an archive route could
 *    not carry the case it exists for. Per file it caps at 64 MiB *per file* —
 *    the unit silo's media library stores things in — and progress, retry and
 *    resume come for free.
 * 3. `GET /plan` proposes one collection per Strapi list, and the operator edits
 *    it. Nothing is written by either.
 * 4. `POST /imports` validates the edited plan and starts a job, answering
 *    immediately — the work outlives the dispatch, because 367 entries do not fit
 *    in a five-second budget.
 * 5. `GET /imports/:id` is what the panel polls.
 *
 * Media becomes **silo's media type** — `x-silo-type: "media"` on a string, so the
 * admin renders the picker and a delete counts the usage. A supplied file lands in
 * silo's library and the entry holds `silo://media/<id>`; an unsupplied one keeps
 * its Strapi URL, which silo resolves by leaving alone. Same schema either way,
 * which is what lets an operator import now and send the files later.
 *
 * One thing it does **not** do, and says so rather than approximating: **it does
 * not import relations.** A Strapi relation is a row in a link table pointing at
 * another content type's `document_id`, and silo has `x-silo-ref` with no
 * integrity enforcement yet (§12.5) — so a faithful import would write ids nothing
 * resolves. Relations are reported in the inventory's `skipped` and left out.
 */

/** The one piece of mutable state a worker holds, built at activation. */
interface Runtime {
  store: SourceStore
  uploads: UploadStore
  jobs: ImportJobs
  /** The inventory of the staged source, read once per upload rather than per
   *  request: it is a dozen queries and the file does not change under us. */
  inventory: Inventory | null
  sequence: number
}

let runtime: Runtime | null = null

function required(): Runtime {
  if (!runtime) throw new Error('the plugin is not activated')
  return runtime
}

function config(ctx: SiloContext) {
  const version = ctx.config.version
  return {
    project: String(ctx.config.project ?? 'default'),
    env: String(ctx.config.env ?? 'prod'),
    prefix: String(ctx.config.collection_prefix ?? ''),
    mediaBaseUrl: String(ctx.config.media_base_url ?? ''),
    mediaFolder: String(ctx.config.media_folder ?? ''),
    version: (StrapiVersions.isVersion(version) ? version : 'published') as StrapiVersion,
  }
}

/** Where the staging directory is. One expression, because `SourceStore` and
 *  `UploadStore` have to agree about it or a restart recovers half a state. */
function workDir(ctx: SiloContext): string | undefined {
  return typeof ctx.config.work_dir === 'string' && ctx.config.work_dir.trim().length > 0
    ? ctx.config.work_dir
    : undefined
}

/** Read the staged source and cache what is in it. */
function inspect(ctx: SiloContext, version: StrapiVersion): Inventory {
  const state = required()
  const staged = state.store.require()
  const source = StrapiDatabase.open(staged.path)
  try {
    state.inventory = StrapiInventory.read(source, version)
    ctx.log.info('read a Strapi source', {
      file: staged.name,
      lists: state.inventory.lists.length,
      skipped: state.inventory.skipped.length,
    })
    return state.inventory
  } finally {
    // Closed before returning, not held for the next request. A read-only handle
    // on a staged file is cheap to reopen and expensive to leak: the operator may
    // delete the source between two requests, and on Windows an open handle is
    // what makes that fail.
    source.close()
  }
}

/** The inventory, re-reading the source if this worker has not seen it yet. */
function inventoryOf(ctx: SiloContext): Inventory {
  const state = required()
  const { version } = config(ctx)
  if (state.inventory && state.inventory.version === version) return state.inventory
  return inspect(ctx, version)
}

/** One project's environments, or none when the grant cannot see them. */
async function environmentsOf(ctx: SiloContext, project: string): Promise<string[]> {
  const response = await ctx.fetch(
    `/api/projects/${encodeURIComponent(project)}/environments`,
  )
  if (!response.ok) return []
  const body = response.json()
  return (body?.items ?? []).map((entry: unknown) =>
    typeof entry === 'string' ? entry : String((entry as any)?.id ?? (entry as any)?.name),
  )
}

/** A refusal the caller can act on. `ValidationError` and not `Error`, so it
 *  answers 400 rather than being treated as a plugin fault (§13.9). */
function refuse(message: string): never {
  throw new ValidationError(message)
}

function body(request: SiloRequest): unknown {
  if (!request.body) refuse('want a JSON body')
  try {
    return JSON.parse(request.body)
  } catch {
    return refuse('that body is not valid JSON')
  }
}

export default defineSiloPlugin({
  /**
   * Recover a source staged before a restart, and nothing else.
   *
   * Declared as a runtime for exactly this: without it, restarting the worker —
   * which the admin offers a button for — would leave the panel reporting no
   * source while a copy of the operator's database sat in the staging directory.
   */
  async activate(ctx: SiloContext) {
    const store = new SourceStore(workDir(ctx))
    const state: Runtime = {
      store,
      uploads: new UploadStore(store.directory),
      jobs: new ImportJobs(),
      inventory: null,
      sequence: 0,
    }
    runtime = state

    const recovered = await state.store.recover()
    if (recovered) {
      ctx.log.info('found a Strapi source staged before this start', {
        path: recovered.path,
        bytes: recovered.bytes,
        uploads: (await state.uploads.index()).size,
      })
    }
  },

  async deactivate() {
    // The staged file is deliberately left. A restart is not a decision to
    // discard an operator's upload, and `DELETE /source` is where that decision
    // is expressed.
    runtime = null
  },

  'GET /source'(_request: SiloRequest, ctx: SiloContext) {
    const state = required()
    const staged = state.store.current()
    if (!staged) return { status: 404, json: { error: { code: 'no_source', message: 'nothing uploaded yet' } } }
    return { json: { source: staged, inventory: inventoryOf(ctx) } }
  },

  /**
   * Take the database.
   *
   * `request.bytes` and not `request.body`: the manifest declares
   * `"body": { "kind": "bytes", "max_bytes": 67108864 }`, which is what puts the
   * cap on the grant screen beside the route and what makes the bytes arrive
   * undecoded. A 1.6 MB `data.db` decoded as UTF-8 would be lossy garbage, and
   * before D41 it would have been refused outright by a one-mebibyte cap.
   */
  async 'POST /source'(request: SiloRequest, ctx: SiloContext) {
    const state = required()
    if (!request.bytes || request.bytes.byteLength === 0) {
      refuse('send the .db file as the request body')
    }

    const name = String(request.query.name ?? 'data.db')
    const staged = await state.store.put(name, request.bytes)
    state.inventory = null

    try {
      const inventory = inspect(ctx, config(ctx).version)
      return { status: 201, json: { source: staged, inventory } }
    } catch (caught: any) {
      // A file that is not a Strapi database is not staged: leaving it would make
      // the next `GET /source` report a source that cannot be read, and the
      // operator would have to delete it to get back to a working panel.
      await state.store.clear()
      return refuse(caught?.message ?? String(caught))
    }
  },

  async 'DELETE /source'() {
    const state = required()
    await state.store.clear()
    state.inventory = null
    return { status: 204 }
  },

  /**
   * Which uploads this import wants, and which have arrived.
   *
   * The answer is a **list of filenames**, and that is what makes a browser
   * directory picker usable at all: Strapi hashes an upload's name and writes it
   * flat into `public/uploads`, so the basename of the `url` column and the name
   * in the operator's folder are the same string, with no path mapping in between.
   *
   * Scoped to the lists the inventory found — a `files` table holds everything the
   * instance ever uploaded, and asking for attachments of content types that were
   * skipped would be asking for work the import will not use.
   */
  async 'GET /files'(_request: SiloRequest, ctx: SiloContext) {
    const state = required()
    const inventory = inventoryOf(ctx)
    const staged = await state.uploads.index()

    const source = StrapiDatabase.open(state.store.require().path)
    let wanted
    try {
      wanted = StrapiMedia.wantedBy(source, StrapiInventory.ownersOf(inventory))
    } finally {
      source.close()
    }

    const files = wanted.map((file) => ({
      name: file.name,
      url: file.url,
      mime: file.mime,
      bytes: file.bytes,
      staged: staged.has(file.name),
    }))
    const here = files.filter((file) => file.staged).length
    let stagedBytes = 0
    for (const size of staged.values()) stagedBytes += size

    return {
      json: {
        files,
        totals: {
          wanted: files.length,
          staged: here,
          missing: files.length - here,
          bytes: stagedBytes,
          /** What the wanted files weigh according to Strapi, so the panel can
           *  say how much is left to send before it sends any of it. */
          wantedBytes: wanted.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
        },
        folder: config(ctx).mediaFolder,
        baseUrl: config(ctx).mediaBaseUrl,
      },
    }
  },

  /**
   * Take one upload's bytes.
   *
   * `?name=` and not a path parameter, matching `POST /source`: a Strapi filename
   * carries dots and would have to be escaped into a path segment for no gain,
   * and `UploadStore.filename` is the one place that decides what a name may be.
   */
  async 'POST /files'(request: SiloRequest, ctx: SiloContext) {
    const state = required()
    if (!request.bytes || request.bytes.byteLength === 0) {
      refuse('send the file as the request body')
    }
    try {
      const staged = await state.uploads.put(String(request.query.name ?? ''), request.bytes)
      return { status: 201, json: staged }
    } catch (caught: any) {
      return refuse(caught?.message ?? String(caught))
    }
  },

  /** Forget every staged upload. Separate from `DELETE /source` on purpose:
   *  Strapi's filenames are content-hashed, so uploads stay valid across a
   *  re-export, and discarding them with the database would make an operator
   *  re-send hundreds of files to fix one row. */
  async 'DELETE /files'() {
    await required().uploads.clear()
    return { status: 204 }
  },

  /** What silo would do with this export if nobody edited anything. */
  'GET /plan'(_request: SiloRequest, ctx: SiloContext) {
    const settings = config(ctx)
    return { json: { plan: ImportPlans.propose(inventoryOf(ctx), settings) } }
  },

  /**
   * The projects and environments a plan could target.
   *
   * Served by the plugin rather than read by the panel, because the panel has no
   * authority of its own — it can only reach this plugin's routes, and this
   * plugin holds the grant that can see them.
   *
   * Two calls, because `ctx.projects.list()` answers project **ids** and
   * environments are a request of their own. A project whose environments cannot
   * be read is still listed with none: the grant may cover one project's
   * environments and not another's, and dropping the project would tell the
   * operator it does not exist.
   */
  async 'GET /targets'(_request: SiloRequest, ctx: SiloContext) {
    const projects = await ctx.projects.list()
    const items = []
    for (const project of projects.items) {
      const id = typeof project === 'string' ? project : String(project.id ?? project.name)
      items.push({ id, environments: await environmentsOf(ctx, id) })
    }
    return { json: { items, default: config(ctx) } }
  },

  /**
   * Validate a plan and start it.
   *
   * The job is started and **not awaited** — see `ImportJobs.start`. The response
   * is the first progress snapshot, so a panel has something to render before its
   * first poll.
   */
  'POST /imports'(request: SiloRequest, ctx: SiloContext) {
    const state = required()
    const inventory = inventoryOf(ctx)
    const staged = state.store.require()

    let plan
    try {
      plan = ImportPlans.read(body(request), inventory)
    } catch (caught: any) {
      return refuse(caught?.message ?? String(caught))
    }

    const job = new ImportJob({
      id: `import-${++state.sequence}-${Date.now().toString(36)}`,
      plan,
      sourcePath: staged.path,
      inventory,
      uploads: state.uploads,
      ctx,
    })

    try {
      state.jobs.start(job)
    } catch (caught: any) {
      return refuse(caught?.message ?? String(caught))
    }

    ctx.log.info('started a Strapi import', {
      job: job.id,
      project: plan.project,
      env: plan.env,
      steps: plan.steps.length,
    })
    return { status: 202, json: job.snapshot() }
  },

  'GET /imports'() {
    return { json: { items: required().jobs.list() } }
  },

  'GET /imports/:id'(request: SiloRequest) {
    const job = required().jobs.find(request.params.id ?? '')
    if (!job) {
      return { status: 404, json: { error: { code: 'no_job', message: 'no such import' } } }
    }
    return { json: job.snapshot() }
  },
})
