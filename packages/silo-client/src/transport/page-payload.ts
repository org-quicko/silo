/** What {@link PagePayload.read} extracts from a list response body. */
export interface PagePayloadRows<Row> {
  rows: Row[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * Reads a list response body. The wire uses `data` for entries and search
 * and `items` for media, collections and projects — this is the only
 * place in the client that knows both names.
 */
export class PagePayload {
  static read<Row>(body: Record<string, unknown>): PagePayloadRows<Row> {
    const rows = (Array.isArray(body.data) ? body.data : Array.isArray(body.items) ? body.items : []) as Row[];

    return {
      rows,
      total: typeof body.total === "number" ? body.total : rows.length,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      offset: typeof body.offset === "number" ? body.offset : undefined,
    };
  }
}
