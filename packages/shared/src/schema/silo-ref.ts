/**
 * The `silo://collections/<name>` `$ref` scheme.
 *
 * Both sides read and write these URLs — the server resolves and bundles them,
 * the admin UI rewrites them into internal `#/$defs/...` pointers for RJSF — so
 * the scheme string and the "which collection does this ref name?" parse live
 * here rather than being restated at each site.
 */
export class SiloRef {
  static readonly CollectionScheme = "silo://collections/";

  static url(collection: string): string {
    return SiloRef.CollectionScheme + collection;
  }

  static isLocal(ref: unknown): boolean {
    return typeof ref === "string" && ref.startsWith(SiloRef.CollectionScheme);
  }

  static isRemote(ref: unknown): boolean {
    return typeof ref === "string" && /^https?:\/\//.test(ref);
  }

  /** The collection a local ref names, ignoring any `#`/`/` fragment. */
  static collectionOf(ref: string): string {
    return ref.slice(SiloRef.CollectionScheme.length).split(/[#/]/)[0];
  }
}
