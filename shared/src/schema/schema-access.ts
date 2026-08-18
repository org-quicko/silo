/**
 * The `x-silo-auth` schema keyword, which decides whether a collection's schema
 * and entries are readable without an API key.
 *
 * The server enforces it and the admin UI's schema editor writes it, so a
 * disagreement about what counts as "on" is a visible access-control bug — the
 * predicate and the writer belong in one place.
 */
export class SchemaAccess {
  static readonly AuthKeyword = "x-silo-auth";

  /** True only for an explicit `true`; anything else leaves the collection public. */
  static requiresAuth(schema: unknown): boolean {
    if (!schema || typeof schema !== "object") return false;
    return (schema as Record<string, unknown>)[SchemaAccess.AuthKeyword] === true;
  }

  /** Sets or clears the keyword; absent rather than `false` keeps schemas clean. */
  static setRequiresAuth(schema: Record<string, unknown>, required: boolean): void {
    if (required) schema[SchemaAccess.AuthKeyword] = true;
    else delete schema[SchemaAccess.AuthKeyword];
  }
}
