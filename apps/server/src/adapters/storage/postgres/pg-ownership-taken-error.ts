/** Another server holds the owner lock for this schema (D25). Not retried:
 *  waiting would only mean two servers taking turns with one database. */
export class PgOwnershipTakenError extends Error {
  constructor(schema: string) {
    super(
      `another silo server already owns Postgres schema "${schema}" in this database; stop it first, or point [storage] schema elsewhere`
    );
    this.name = "PgOwnershipTakenError";
  }
}
