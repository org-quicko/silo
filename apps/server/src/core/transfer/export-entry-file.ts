import type { Entry } from "../domain/entry";
import type { Scope } from "../domain/scope";
import { SchemaOrder } from "../schema/schema-order";

/**
 * One entry as the archive holds it: its path in the tree, and the JSON inside.
 *
 * Shared by the scope walk and the system-scope walk so the two cannot drift on
 * what an archived entry looks like. The envelope carries names, not record
 * ids — the path is the addressing authority on the way back in (§7.2).
 */
export class ExportEntryFile {
  static path(scope: Scope, collection: string, id: string): string {
    return `projects/${scope.project}/${scope.env}/content/${collection}/${id}.json`;
  }

  /** `schema` orders the data as the API does (D93), so an archive reads the
   *  same whichever store it was exported from. */
  static text(entry: Entry, schema?: any): string {
    return JSON.stringify(
      {
        id: entry.id,
        project: entry.project,
        env: entry.env,
        collection: entry.collection,
        rev: entry.rev,
        seq: entry.seq,
        created_at: ExportEntryFile.instant(entry.created_at),
        updated_at: ExportEntryFile.instant(entry.updated_at),
        data: SchemaOrder.apply(entry.data, schema),
      },
      null,
      2
    );
  }

  private static instant(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }
}
