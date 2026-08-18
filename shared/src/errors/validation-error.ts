import type { ValidationDetail } from "./validation-detail";

/**
 * Invalid input, from any layer. This lives in `@silo/shared` rather than in the
 * server because shared protocol rules (claim validation, for one) must be able
 * to raise it: if they raised their own error type instead, every server catch
 * site and the HTTP error handler would need to know about both, and any site
 * that forgot would downgrade a 400 into a 500.
 *
 * Mapping this to an HTTP status stays in the server — that is the server's
 * concern, not a shared one.
 *
 * Catch sites must use {@link ValidationError.is}, never `instanceof`. This
 * class is raised inside one package and caught in another, and `instanceof`
 * only answers "same prototype", which stops being true the moment a second
 * copy of this module is loaded — a `file:`-copied dependency, a `dist/` build
 * alongside `src/`, a bundler with different export conditions. Nothing would
 * throw: the HTTP handler would just downgrade every 400 to a 500 and
 * `Service.listKeys` would rethrow instead of skipping malformed records. The
 * brand is compared by value, so it survives duplicate module instances.
 */
export class ValidationError extends Error {
  /** Nominal marker stamped on every instance; see {@link ValidationError.is}. */
  static readonly Brand = "silo.ValidationError";

  readonly brand = ValidationError.Brand;
  details: ValidationDetail[];

  constructor(message: string, details: ValidationDetail[] = []) {
    let fullMessage = message;
    if (details.length > 0) {
      const parts = details.map((d) => `"${d.path}": ${d.message}`);
      fullMessage = `${message}: ${parts.join("; ")}`;
    }
    super(fullMessage);
    this.name = "ValidationError";
    // Keep reference to clean message and details for API responses
    this.message = fullMessage;
    this.details = details;
  }

  /**
   * The `instanceof` replacement for this class. Identifies an error raised by
   * any copy of this module, because it compares the brand's value rather than
   * prototype identity.
   */
  static is(error: unknown): error is ValidationError {
    return error instanceof Error && (error as { brand?: string }).brand === ValidationError.Brand;
  }
}
