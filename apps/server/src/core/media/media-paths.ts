import { ValidationError } from "@silo/shared/validation-error";

/**
 * Folder path and blob key rules for the media catalog (D23).
 *
 * Folders are metadata, so a path here never reaches the blob store — it is
 * normalised, validated, and stored on a `_media` document. Blob keys stay
 * flat for the same reason: nothing about a file's organisation is encoded in
 * where its bytes live, which is what makes a move a single field update and
 * leaves the archive's `media/` layout (§7.1) unchanged.
 */
export class MediaPaths {
  static readonly MaxDepth = 16;
  static readonly MaxSegment = 64;
  /** Close to a collection name's grammar, so folders read like the rest of silo. */
  private static readonly SegmentPattern = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/;

  /**
   * Normalises a caller-supplied folder to "" (root) or "/a/b". Rejects
   * traversal, empty segments, and anything that would not survive a round
   * trip through a URL query.
   */
  static normalizeFolder(input: unknown): string {
    if (input === undefined || input === null) return "";
    if (typeof input !== "string") {
      throw new ValidationError("folder must be a string");
    }
    const trimmed = input.trim();
    if (!trimmed || trimmed === "/") return "";

    const segments = trimmed.split("/").filter((s) => s.length > 0);
    if (segments.length > MediaPaths.MaxDepth) {
      throw new ValidationError(`folder is deeper than ${MediaPaths.MaxDepth} levels`);
    }
    for (const segment of segments) {
      if (segment === "." || segment === "..") {
        throw new ValidationError(`invalid folder segment "${segment}"`);
      }
      if (segment.length > MediaPaths.MaxSegment) {
        throw new ValidationError(
          `folder segment "${segment}" is longer than ${MediaPaths.MaxSegment} characters`
        );
      }
      if (!MediaPaths.SegmentPattern.test(segment)) {
        throw new ValidationError(`invalid folder segment "${segment}"`);
      }
    }
    return "/" + segments.join("/");
  }

  /** Every ancestor of a folder, root-first, including the folder itself. */
  static ancestors(folder: string): string[] {
    if (!folder) return [];
    const segments = folder.split("/").filter((s) => s.length > 0);
    const out: string[] = [];
    let acc = "";
    for (const segment of segments) {
      acc += "/" + segment;
      out.push(acc);
    }
    return out;
  }

  /** True when `folder` is `parent` or sits underneath it. */
  static isWithin(folder: string, parent: string): boolean {
    if (!parent) return true;
    return folder === parent || folder.startsWith(parent + "/");
  }

  /** A display filename: cleaned for presentation, never used for addressing. */
  static normalizeFilename(input: unknown, fallback = "file"): string {
    const raw = typeof input === "string" ? input.trim() : "";
    const base = raw.split(/[/\\]/).pop() || "";
    // Control characters would render as invisible junk in the library UI.
    const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
    return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
  }

  /**
   * The blob key for a new asset. Flat and derived from the asset id, so it is
   * 1:1 with the catalog record — no two assets ever share bytes, which keeps
   * deletion a decision about one record rather than a second refcount over
   * the blob store. Kept in one function so the naming policy can change
   * without touching the record shape (`blob_key` is stored, not derived).
   */
  static blobKey(assetId: string, filename: string): string {
    const dot = filename.lastIndexOf(".");
    if (dot <= 0) return assetId;
    const ext = filename.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "");
    return ext.length > 1 && ext.length <= 12 ? `${assetId}${ext}` : assetId;
  }
}
