import type { SiloContext, SiloPluginDefinition, SiloRequest } from 'silo:api'
import { StrapiInventory } from '../strapi/strapi-inventory'
import { StrapiMedia } from '../strapi/strapi-media'
import { ImportRuntime } from '../worker/import-runtime'
import { RouteInput } from './route-input'

/**
 * `/files` — Strapi's `public/uploads`, one file per request.
 *
 * **One file and not an archive**: the 64 MiB body ceiling is per request and a
 * real instance's uploads directory is routinely bigger, so an archive route
 * could not carry the case it exists for. Per file the cap is the unit silo's
 * media library stores in, and progress, retry and resume come for free.
 */
export class UploadRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      /**
       * Which uploads this import wants, and which have arrived.
       *
       * The answer is a **list of filenames**, and that is what makes a browser
       * directory picker usable at all: Strapi hashes an upload's name and writes
       * it flat into `public/uploads`, so the basename of the `url` column and
       * the name in the operator's folder are the same string, with no path
       * mapping in between.
       *
       * Scoped to the lists the inventory found — a `files` table holds
       * everything the instance ever uploaded, and asking for attachments of
       * content types that were skipped would be asking for work the import will
       * not use.
       */
      async 'GET /files'(_request: SiloRequest, ctx: SiloContext) {
        const runtime = ImportRuntime.current()
        const inventory = runtime.inventory(ctx)
        const staged = await runtime.uploads.index()

        const wanted = runtime.withSource((source) =>
          StrapiMedia.wantedBy(source, StrapiInventory.ownersOf(inventory)),
        )

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
              /** What the wanted files weigh according to Strapi, so the panel
               *  can say how much is left to send before it sends any of it. */
              wantedBytes: wanted.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
            },
            folder: runtime.settings.mediaFolder,
            baseUrl: runtime.settings.mediaBaseUrl,
          },
        }
      },

      /**
       * Take one upload's bytes.
       *
       * `?name=` and not a path parameter, matching `POST /source`: a Strapi
       * filename carries dots and would have to be escaped into a path segment
       * for no gain, and `UploadStore.filename` is the one place that decides
       * what a name may be.
       */
      async 'POST /files'(request: SiloRequest) {
        const runtime = ImportRuntime.current()
        const bytes = RouteInput.bytes(request, 'send the file as the request body')
        try {
          return {
            status: 201,
            json: await runtime.uploads.put(String(request.query.name ?? ''), bytes),
          }
        } catch (caught: unknown) {
          return RouteInput.refuse(RouteInput.reason(caught))
        }
      },

      /** Forget every staged upload. Separate from `DELETE /source` on purpose:
       *  Strapi's filenames are content-hashed, so uploads stay valid across a
       *  re-export, and discarding them with the database would make an operator
       *  re-send hundreds of files to fix one row. */
      async 'DELETE /files'() {
        await ImportRuntime.current().uploads.clear()
        return { status: 204 }
      },
    }
  }
}
