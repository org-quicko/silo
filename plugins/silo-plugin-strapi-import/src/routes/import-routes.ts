import type { SiloContext, SiloPluginDefinition, SiloRequest } from 'silo:api'
import { ImportJob } from '../import/import-job'
import { ImportPlans } from '../import/import-plan'
import { ImportRuntime } from '../worker/import-runtime'
import { RouteInput } from './route-input'

/**
 * `/imports` — starting a run, and watching it.
 *
 * `POST` answers immediately with the first progress snapshot and the work
 * outlives the dispatch: 367 entries each going through validation and the write
 * lock do not fit in a five-second budget, so a synchronous import would time
 * out, be declared a plugin fault, and take the worker down mid-write.
 *
 * A run is the caller's own, and so is the history: `GET /imports` answers what
 * *this* operator has run. What is shared is only `RunningTargets`, which is the
 * one thing that has to be — two people may import at once, and not into the
 * same collection.
 */
export class ImportRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      'POST /imports'(request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const session = runtime.session(request)
        const inventory = session.inventory(ctx)
        const staged = session.store.require()

        let plan
        try {
          plan = ImportPlans.read(RouteInput.json(request), inventory)
        } catch (caught: unknown) {
          return RouteInput.refuse(RouteInput.reason(caught))
        }

        const job = new ImportJob({
          id: session.nextJobId(),
          plan,
          sourcePath: staged.path,
          inventory,
          uploads: session.uploads,
          ctx,
        })

        // Claimed before the job starts and released however it ends, because
        // the run outlives the dispatch that asked for it.
        let release: () => void
        try {
          release = runtime.targets.claim(job.id, plan)
        } catch (caught: unknown) {
          return RouteInput.refuse(RouteInput.reason(caught))
        }

        try {
          session.jobs.start(job, release)
        } catch (caught: unknown) {
          release()
          return RouteInput.refuse(RouteInput.reason(caught))
        }

        ctx.log.info('started a Strapi import', {
          job: job.id,
          session: session.key,
          project: plan.project,
          env: plan.env,
          steps: plan.steps.length,
        })
        return { status: 202, json: job.snapshot() }
      },

      'GET /imports'(request: SiloRequest) {
        return { json: { items: ImportRuntime.current().session(request).jobs.list() } }
      },

      'GET /imports/:id'(request: SiloRequest) {
        const session = ImportRuntime.current().session(request)
        const job = session.jobs.find(request.params.id ?? '')
        if (!job) {
          return { status: 404, json: { error: { code: 'no_job', message: 'no such import' } } }
        }
        return { json: job.snapshot() }
      },
    }
  }
}
