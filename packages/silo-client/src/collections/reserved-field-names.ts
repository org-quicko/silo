/**
 * The five field names the server strips from every entry response before
 * answering, verified against `EntryUtils.toApiResponse`. A schema
 * declaring one still validates and stores it; it just never comes back.
 */
export class ReservedFieldNames {
  static readonly all: readonly string[] = ["id", "rev", "seq", "created_at", "updated_at"];

  static isReserved(name: string): boolean {
    return ReservedFieldNames.all.includes(name);
  }
}
