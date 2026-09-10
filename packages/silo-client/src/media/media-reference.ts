/**
 * The `silo://media/<id>` scheme an entry field holds to name a catalogued
 * asset — the client-side counterpart to `@silo/shared`'s `MediaRef`, not
 * imported here since this package ships zero runtime dependencies.
 *
 * Recognises only the canonical scheme form, deliberately narrower than the
 * server's `MediaRef`: a client either builds a reference itself or reads one
 * back verbatim, so accepting `asset.url` would let "I stored the wrong
 * property" keep working until the first rename.
 */
export class MediaReference {
  private static readonly Scheme = "silo://media/";

  /** Builds the reference to store in an entry field: `silo://media/<id>`. */
  static of(id: string): string {
    return MediaReference.Scheme + id;
  }

  /** The asset id a `silo://media/` reference names, or `null` if `value`
   * is not one. A trailing fragment, query or path segment is ignored. */
  static idOf(value: unknown): string | null {
    if (typeof value !== "string" || !value.startsWith(MediaReference.Scheme)) return null;
    const id = value.slice(MediaReference.Scheme.length).split(/[#?/]/)[0];
    return id ? id : null;
  }
}
