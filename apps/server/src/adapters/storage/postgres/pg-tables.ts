import { ValidationError } from "@silo/shared/validation-error";

/**
 * Every table name, qualified with the schema silo lives in.
 *
 * Qualified in the SQL rather than reached through `search_path`, so no
 * statement depends on session state that a pooler in transaction mode would
 * not carry from one transaction to the next.
 *
 * The schema name is restricted to lower-case letters, digits and `_`, which
 * is why it can be spliced into SQL: it never needs quoting inside the quotes,
 * and it means the same thing to Postgres as it does in `silo.toml`.
 */
export class PgTables {
  private static readonly SchemaPattern = /^[a-z_][a-z0-9_]{0,62}$/;

  /** Every table the adapter owns, in the order the DDL creates them. */
  static readonly Names = [
    "meta",
    "projects",
    "environments",
    "collections",
    "entries",
    "media_references",
  ] as const;

  readonly schema: string;
  readonly quotedSchema: string;
  readonly meta: string;
  readonly projects: string;
  readonly environments: string;
  readonly collections: string;
  readonly entries: string;
  readonly mediaReferences: string;
  /** The search documents (D30). Not in {@link PgTables.Names}: it exists only
   *  while search is on, so its absence is no sign of an incomplete schema. */
  readonly searchDocuments: string;

  private constructor(schema: string) {
    this.schema = schema;
    this.quotedSchema = `"${schema}"`;
    this.meta = this.qualify("meta");
    this.projects = this.qualify("projects");
    this.environments = this.qualify("environments");
    this.collections = this.qualify("collections");
    this.entries = this.qualify("entries");
    this.mediaReferences = this.qualify("media_references");
    this.searchDocuments = this.qualify("entry_search");
  }

  static for(schema: string): PgTables {
    if (!PgTables.SchemaPattern.test(schema)) {
      throw new ValidationError(
        `invalid Postgres schema name "${schema}": use lower-case letters, digits and "_", starting with a letter or "_", at most 63 characters`
      );
    }
    return new PgTables(schema);
  }

  qualify(table: string): string {
    return `${this.quotedSchema}."${table}"`;
  }
}
