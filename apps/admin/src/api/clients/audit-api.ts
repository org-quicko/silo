import type { AuditEvent } from '../types/audit-event'
import type { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'

/** One page of the authority trail. */
export interface AuditPage {
  items: AuditEvent[]
  total: number
  limit: number
  offset: number
}

/**
 * The trail of authority changes (D38), behind `audit:read`.
 *
 * Read-only because there is nothing else it could be: nothing in silo updates
 * or deletes an event, so there is no `audit:write` for a method to call.
 */
export class AuditApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** `subject` narrows to one key id or plugin name, which is the question
   *  anyone actually brings to a trail. */
  list(
    url: string,
    key: string,
    query: { subject?: string; limit?: number; offset?: number } = {},
  ): Promise<AuditPage> {
    const params = new QueryParams()
      .set('subject', query.subject)
      .set('limit', query.limit)
      .set('offset', query.offset)
    return this.transport.request<AuditPage>(url, key, `/api/audit${params}`)
  }
}
