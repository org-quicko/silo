/**
 * The `silo://media/<ulid>` scheme entries use to name a media asset (D23).
 *
 * Entries reference an asset by its catalog id, never by its storage path, so
 * renaming a file or moving it between folders rewrites no entry and touches
 * no blob. Both sides need the scheme — the server extracts references out of
 * entry data and resolves them into URLs on read, the admin UI writes them
 * from the media picker — so the string and its parse live here.
 *
 * Pre-D23 entries hold the storage path instead (`/media/<blobKey>`, or an
 * absolute URL ending in one). Those are still recognised, and normalise to a
 * distinct `blob:<key>` token so the delete guard counts them as usages while
 * an instance is only partly backfilled.
 */
export class MediaRef {
  static readonly Scheme = "silo://media/";
  /** Marks a usage token that names a blob key rather than a catalog id. */
  static readonly BlobTokenPrefix = "blob:";

  static url(id: string): string {
    return MediaRef.Scheme + id;
  }

  static is(value: unknown): boolean {
    return typeof value === "string" && value.startsWith(MediaRef.Scheme);
  }

  /** The asset id a `silo://media/` reference names, ignoring any fragment. */
  static idOf(ref: string): string {
    return ref.slice(MediaRef.Scheme.length).split(/[#?/]/)[0];
  }

  /**
   * The blob key a pre-D23 reference names, or null. Accepts `/media/<key>`,
   * `media/<key>`, and absolute URLs whose path contains `/media/<key>`.
   */
  static legacyKeyOf(value: unknown): string | null {
    if (typeof value !== "string") return null;
    let str = value.trim();
    if (!str) return null;
    if (str.startsWith("http://") || str.startsWith("https://")) {
      try {
        str = new URL(str).pathname;
      } catch {
        return null;
      }
    }
    const idx = str.indexOf("/media/");
    if (idx !== -1) {
      str = str.slice(idx + "/media/".length);
    } else if (str.startsWith("media/")) {
      str = str.slice("media/".length);
    } else {
      return null;
    }
    const key = decodeURIComponent(str.split(/[#?]/)[0]);
    return key ? key : null;
  }

  /**
   * The usage token a value references, or null if it references nothing.
   * The one entry point: everything that decides "is this a media reference"
   * goes through here so the server's extractor and the delete guard cannot
   * disagree about what counts.
   */
  static token(value: unknown): string | null {
    if (typeof value !== "string") return null;
    if (MediaRef.is(value)) {
      const id = MediaRef.idOf(value);
      return id ? id : null;
    }
    const legacy = MediaRef.legacyKeyOf(value);
    return legacy ? MediaRef.BlobTokenPrefix + legacy : null;
  }

  /** The token naming a blob key directly, for the guard's dual-read. */
  static blobToken(blobKey: string): string {
    return MediaRef.BlobTokenPrefix + blobKey;
  }

  /**
   * A bare ULID — the shape `EntryUtils.newID()` produces, and therefore the
   * shape a catalog id has.
   */
  private static readonly UlidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

  /**
   * The canonical reference for a value that already names a catalog asset,
   * or null.
   *
   * Reads resolve a media field into a fully qualified URL, so a client that
   * fetches an entry, edits one field and PUTs it back hands the server
   * `<base>/media/<id>` where `silo://media/<id>` went out. Without this the
   * round trip would silently rewrite a live reference into something the
   * delete guard no longer counts — the exact failure D23 exists to prevent —
   * so the write path canonicalises before storing.
   *
   * A `/media/<segment>` URL is ambiguous on its face: it addresses a catalog
   * id since D23 and a raw blob key before it. They are told apart by shape.
   * A catalog id is a bare ULID; a blob key is either `<ulid><ext>` (carries a
   * dot) or the pre-D23 `<sha256>_<name>` (carries an underscore), so neither
   * can be mistaken for one.
   */
  static canonical(value: unknown): string | null {
    const id = MediaRef.canonicalId(value);
    return id ? MediaRef.url(id) : null;
  }

  /** The catalog id a value names in any recognised form, or null. */
  static canonicalId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    if (MediaRef.is(value)) {
      const id = MediaRef.idOf(value);
      return id ? id : null;
    }
    const key = MediaRef.legacyKeyOf(value);
    return key && MediaRef.UlidPattern.test(key) ? key : null;
  }
}
