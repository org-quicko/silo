import { PageWindow } from "../pagination/page-window.js";
import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { TransportQueryValue } from "../transport/transport-request.js";
import { TrashPage } from "./trash-page.js";
import type { TrashQuery } from "./trash-query.js";
import type { TrashRecord } from "./trash-record.js";
import type { TrashRestoreResult } from "./trash-restore-result.js";

/**
 * The trash (D91): what a delete left behind, and the two ways out of it.
 *
 * Instance-global like the media library, so it takes no scope. Listing takes
 * no claim of its own — the server filters each item by the read claim its
 * origin already required, so two keys see two different trashes.
 */
export class Trash {
  constructor(private readonly transport: Transport) {}

  list(query: TrashQuery = {}, options?: RequestOptions): Promise<TrashPage> {
    const window = new PageWindow(query.limit ?? 50, query.offset ?? 0);
    return TrashPage.loadWindow(this.transport, Trash.toWireQuery(query), window, options);
  }

  get(id: string, options?: RequestOptions): Promise<TrashRecord> {
    return this.transport.json<TrashRecord>({
      method: "GET",
      path: ApiPath.trashItem(id),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  /** The records this receipt parked. Read-only: restoring is all or nothing
   *  per receipt, the rule the FreeDesktop trash spec states for directories. */
  contents(
    id: string,
    page: { limit?: number; offset?: number } = {},
    options?: RequestOptions,
  ): Promise<{ items: unknown[]; total: number }> {
    return this.transport.json<{ items: unknown[]; total: number }>({
      method: "GET",
      path: ApiPath.trashItemContents(id),
      query: { limit: page.limit, offset: page.offset },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  /**
   * Puts the content back, asking for the write claims at the destination.
   *
   * `chain` restores the containers blocking this one first; `rename` applies
   * to the subject alone, for when the freed name was taken meanwhile.
   */
  restore(
    id: string,
    restore: { rename?: string; chain?: boolean } = {},
    options?: RequestOptions,
  ): Promise<TrashRestoreResult> {
    return this.transport.json<TrashRestoreResult>({
      method: "POST",
      path: ApiPath.trashRestore(id),
      body: restore,
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  /** Destroys one receipt and everything it parked. Needs `trash:purge`. */
  async purge(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.empty({
      method: "DELETE",
      path: ApiPath.trashItem(id),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  /** Empties the trash. Needs `trash:purge`. The confirmation word the route
   *  asks for is sent here, because calling a method named `empty` is already
   *  the deliberate act that word is guarding. */
  empty(options?: RequestOptions): Promise<{ purged: number }> {
    return this.transport.json<{ purged: number }>({
      method: "POST",
      path: ApiPath.trashPurge(),
      body: { confirm: "empty" },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  private static toWireQuery(query: TrashQuery): Record<string, TransportQueryValue> {
    return {
      kind: query.kind,
      project: query.project,
      env: query.env,
      collection: query.collection,
      deleted_after: query.deletedAfter,
      deleted_before: query.deletedBefore,
      q: query.q,
    };
  }
}
