import type { SiloContext, SiloPluginDefinition, SiloRequest } from 'silo:api'
import { ImportRuntime } from '../worker/import-runtime'
import { RouteInput } from './route-input'

/**
 * `/source` — the Strapi database itself, staged while the operator plans.
 *
 * `POST` takes the `.db` as **bytes**, which is the route that could not exist
 * before D41: a plugin route decoded every body as text and capped it at one
 * mebibyte, so a plugin whose job is reading a file had no way to be handed one.
 */
export class SourceRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      'GET /source'(_request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const staged = runtime.store.current()
        if (!staged) {
          return {
            status: 404,
            json: { error: { code: 'no_source', message: 'nothing uploaded yet' } },
          }
        }
        return { json: { source: staged, inventory: runtime.inventory(ctx) } }
      },

      /**
       * Take the database.
       *
       * `request.bytes` and not `request.body`: the manifest declares
       * `"body": { "kind": "bytes", "max_bytes": 67108864 }`, which is what puts
       * the cap on the grant screen beside the route and what makes the bytes
       * arrive undecoded. A 1.6 MB `data.db` decoded as UTF-8 would be lossy
       * garbage.
       */
      async 'POST /source'(request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const bytes = RouteInput.bytes(request, 'send the .db file as the request body')

        const staged = await runtime.store.put(String(request.query.name ?? 'data.db'), bytes)
        runtime.forget()

        try {
          return { status: 201, json: { source: staged, inventory: runtime.read(ctx) } }
        } catch (caught: unknown) {
          // A file that is not a Strapi database is not staged: leaving it would
          // make the next `GET /source` report a source that cannot be read, and
          // the operator would have to delete it to get back to a working panel.
          await runtime.store.clear()
          return RouteInput.refuse(RouteInput.reason(caught))
        }
      },

      async 'DELETE /source'() {
        const runtime = ImportRuntime.current()
        await runtime.store.clear()
        runtime.forget()
        return { status: 204 }
      },
    }
  }
}
