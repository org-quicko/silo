import type { SiloContext, SiloPluginDefinition, SiloRequest } from 'silo:api'
import { ImportRuntime } from '../worker/import-runtime'
import { RouteInput } from './route-input'

/**
 * `/source` — the Strapi database itself, staged while the operator plans.
 *
 * `POST` takes the `.db` as **bytes**, which is the route that could not exist
 * before D41: a plugin route decoded every body as text and capped it at one
 * mebibyte, so a plugin whose job is reading a file had no way to be handed one.
 *
 * Every route here answers about the **caller's own** session and no other:
 * `ImportRuntime.session` is what makes two operators staging two databases two
 * separate things rather than the second overwriting the first.
 */
export class SourceRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      'GET /source'(request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const session = runtime.session(request)
        const staged = session.store.current()
        if (!staged) {
          return {
            status: 404,
            json: { error: { code: 'no_source', message: 'nothing uploaded yet' } },
          }
        }
        return {
          json: {
            source: staged,
            inventory: session.inventory(ctx),
            ttlHours: runtime.settings.sessionTtlHours,
          },
        }
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
        const session = runtime.session(request)
        const bytes = RouteInput.bytes(request, 'send the .db file as the request body')

        const staged = await session.store.put(String(request.query.name ?? 'data.db'), bytes)
        session.forget()

        try {
          return {
            status: 201,
            json: {
              source: staged,
              inventory: session.read(ctx),
              ttlHours: runtime.settings.sessionTtlHours,
            },
          }
        } catch (caught: unknown) {
          // A file that is not a Strapi database is not staged: leaving it would
          // make the next `GET /source` report a source that cannot be read, and
          // the operator would have to delete it to get back to a working panel.
          await session.store.clear()
          return RouteInput.refuse(RouteInput.reason(caught))
        }
      },

      async 'DELETE /source'(request: SiloRequest) {
        const session = ImportRuntime.current().session(request)
        await session.store.clear()
        session.forget()
        return { status: 204 }
      },
    }
  }
}
