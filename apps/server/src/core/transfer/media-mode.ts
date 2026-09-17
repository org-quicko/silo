import { ValidationError } from "@silo/shared/validation-error";

/**
 * What an archive does about media bytes.
 *
 * - `all` — every blob in the library, whether anything points at it or not.
 * - `referenced` — only the blobs the exported entries actually reference.
 * - `none` — no bytes at all. The catalog still rides, so filenames, folders
 *   and URLs survive; the bytes are expected to be already at the destination,
 *   which is the normal case when two instances share one bucket.
 *
 * The catalog is filtered to match in every mode, so `_media` never describes
 * an asset the archive neither carries nor leaves behind on purpose. See §7.7
 * in [docs/design/transfer.md](../../../../../docs/design/transfer.md).
 */
export type MediaMode = "all" | "referenced" | "none";

export class MediaModes {
  static readonly All: MediaMode = "all";
  static readonly Referenced: MediaMode = "referenced";
  static readonly None: MediaMode = "none";

  static isMediaMode(value: unknown): value is MediaMode {
    return value === MediaModes.All || value === MediaModes.Referenced || value === MediaModes.None;
  }

  /**
   * The mode to use when the caller named none.
   *
   * A whole-instance archive defaults to `all`, because "export everything"
   * has to stay lossless — dropping unreferenced uploads would make the default
   * export quietly unable to restore the library it came from. A selective one
   * defaults to `referenced`, because naming one collection and receiving the
   * entire media library is not what anybody meant.
   */
  static default(selective: boolean): MediaMode {
    return selective ? MediaModes.Referenced : MediaModes.All;
  }

  /** Validating parse for a caller-supplied value; `undefined` takes the default. */
  static parse(value: unknown, selective: boolean): MediaMode {
    if (value === undefined || value === "") return MediaModes.default(selective);
    if (!MediaModes.isMediaMode(value)) {
      throw new ValidationError(
        `invalid media mode ${JSON.stringify(value)}: want "all", "referenced" or "none"`
      );
    }
    return value;
  }
}
