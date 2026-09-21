/**
 * A record's id and birth instant, in the shape the fs adapter reads back.
 *
 * Projects, environments and collections each carry one (D51); it is what lets
 * a round trip restore the identity the source had rather than minting a new
 * id for every record.
 */
export class ExportMarker {
  static text(id: string, createdAt: Date): string {
    return JSON.stringify({ id, created_at: createdAt.toISOString() });
  }
}
