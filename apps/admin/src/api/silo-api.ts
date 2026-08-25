import { CollectionsApi } from './clients/collections-api'
import { EntriesApi } from './clients/entries-api'
import { KeysApi } from './clients/keys-api'
import { MediaApi } from './clients/media-api'
import { ProjectsApi } from './clients/projects-api'
import { SearchApi } from './clients/search-api'
import { SessionApi } from './clients/session-api'
import { TransferApi } from './clients/transfer-api'
import { HttpTransport } from './transport/http-transport'

/**
 * The typed client for the silo REST API (§8), grouped by what each call acts
 * on: `api.entries.create(...)`, `api.media.upload(...)`.
 *
 * Every client shares one `HttpTransport`, so the bearer header, the error
 * shape and the 401 redirect are stated once. `url` and `key` stay per-call
 * because the admin UI talks to several servers.
 */
export class SiloApi {
  private readonly transport = new HttpTransport()

  readonly session = new SessionApi(this.transport)
  readonly projects = new ProjectsApi(this.transport)
  readonly collections = new CollectionsApi(this.transport)
  readonly entries = new EntriesApi(this.transport)
  readonly search = new SearchApi(this.transport)
  readonly keys = new KeysApi(this.transport)
  readonly media = new MediaApi(this.transport)
  readonly transfer = new TransferApi(this.transport)

  /** A stored key can be revoked out from under an open session; a 401 on any
   *  authenticated call routes the app back to the welcome gate. */
  setUnauthorizedHandler(handler: (() => void) | null): void {
    this.transport.setUnauthorizedHandler(handler)
  }
}

export const api = new SiloApi()
