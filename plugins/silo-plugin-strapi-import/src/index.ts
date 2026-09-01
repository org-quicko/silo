import { defineSiloPlugin } from 'silo:api'
import type { SiloContext } from 'silo:api'
import { ImportRoutes } from './routes/import-routes'
import { PlanRoutes } from './routes/plan-routes'
import { SourceRoutes } from './routes/source-routes'
import { UploadRoutes } from './routes/upload-routes'
import { ImportRuntime } from './worker/import-runtime'

/**
 * Import a Strapi 5 SQLite export into silo collections.
 *
 * The flow the panel drives, one route group per step:
 *
 * 1. `SourceRoutes` takes the `.db` as bytes and answers with what is in it.
 * 2. `UploadRoutes` says which uploads the import wants and takes them, one file
 *    per request.
 * 3. `PlanRoutes` proposes one collection per Strapi list, and says which
 *    projects and environments it could be written into. Nothing is written by
 *    either.
 * 4. `ImportRoutes` validates the edited plan, starts a job, and reports on it.
 *
 * Media becomes **silo's media type** — `x-silo-type: "media"` on a string, so
 * the admin renders the picker and a delete counts the usage. A supplied file
 * lands in silo's library and the entry holds `silo://media/<id>`; an unsupplied
 * one keeps its Strapi URL, which silo resolves by leaving alone. Same schema
 * either way, which is what lets an operator import now and send the files later.
 *
 * Two things it does **not** do, and says so rather than approximating:
 *
 * - **It does not import relations.** A Strapi relation is a row in a link table
 *   pointing at another content type's `document_id`, and silo has `x-silo-ref`
 *   with no integrity enforcement yet (§12.5) — so a faithful import would write
 *   ids nothing resolves. Relations are reported in the inventory's `skipped`.
 * - **It does not decide where an import goes.** That is chosen on the plan,
 *   against the projects silo actually has (`SiloTargets`); nothing in
 *   `[plugins.config]` names a scope.
 *
 * See [the README](../README.md) for the operator's view, and
 * `docs/design/plugins.md` §13 for the contract this is written against.
 */
export default defineSiloPlugin({
  /**
   * Build the worker's state, and recover a source staged before a restart.
   *
   * Declared as a runtime for exactly that: without it, restarting the worker —
   * which the admin offers a button for — would leave the panel reporting no
   * source while a copy of the operator's database sat in the staging directory.
   */
  async activate(ctx: SiloContext) {
    await ImportRuntime.start(ctx)
  },

  deactivate() {
    ImportRuntime.stop()
  },

  ...SourceRoutes.handlers(),
  ...UploadRoutes.handlers(),
  ...PlanRoutes.handlers(),
  ...ImportRoutes.handlers(),
})
