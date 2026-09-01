import type { SiloContext, SiloPluginDefinition, SiloRequest } from 'silo:api'
import { ImportPlans } from '../import/import-plan'
import { SiloTargets } from '../silo/silo-targets'
import { ImportRuntime } from '../worker/import-runtime'

/**
 * `/plan` and `/targets` — what silo proposes, and where it could go.
 *
 * Neither writes anything. The plan is a document the operator edits and hands
 * back to `POST /imports`, so "what will happen" is always something somebody
 * could have read first.
 */
export class PlanRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      /**
       * What silo would do with this export if nobody edited anything.
       *
       * The proposed scope is read from silo, not from `[plugins.config]`: the
       * plan is where a target is chosen, and a configured one would be a second
       * answer the panel could silently disagree with.
       */
      async 'GET /plan'(_request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const targets = await SiloTargets.list(ctx)
        return {
          json: {
            plan: ImportPlans.propose(runtime.inventory(ctx), {
              scope: SiloTargets.defaultOf(targets),
              prefix: runtime.settings.prefix,
              mediaBaseUrl: runtime.settings.mediaBaseUrl,
              mediaFolder: runtime.settings.mediaFolder,
            }),
            targets,
          },
        }
      },

      /** The projects and environments a plan could target, for the two selects
       *  at the top of it. */
      async 'GET /targets'(_request: SiloRequest, ctx: SiloContext) {
        const items = await SiloTargets.list(ctx)
        return { json: { items, default: SiloTargets.defaultOf(items) } }
      },
    }
  }
}
