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
 */
export class ImportRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      'POST /imports'(request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const inventory = runtime.inventory(ctx)
        const staged = runtime.store.require()

        let plan
        try {
          plan = ImportPlans.read(RouteInput.json(request), inventory)
        } catch (caught: unknown) {
          return RouteInput.refuse(RouteInput.reason(caught))
        }

        const job = new ImportJob({
          id: runtime.nextJobId(),
          plan,
          sourcePath: staged.path,
          inventory,
          uploads: runtime.uploads,
          ctx,
        })

        try {
          runtime.jobs.start(job)
        } catch (caught: unknown) {
          return RouteInput.refuse(RouteInput.reason(caught))
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
        return { json: { items: ImportRuntime.current().jobs.list() } }
      },

      'GET /imports/:id'(request: SiloRequest) {
        const job = ImportRuntime.current().jobs.find(request.params.id ?? '')
        if (!job) {
          return { status: 404, json: { error: { code: 'no_job', message: 'no such import' } } }
        }
        return { json: job.snapshot() }
      },
    }
  }
}
