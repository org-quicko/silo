import { EntryUtils } from "../../../core/domain/entry-utils";
import { FsFiles } from "./fs-files";

/** What a marker file holds: a record's id, when it was created, and — for a
 *  collection mid-rename — where the move it is finishing came from (D51). */
export interface FsMarkerData {
  id: string;
  created_at: Date;
  moving_from?: string;
}

/**
 * The marker files that carry record identity in the fs adapter.
 *
 * A marker is a dotfile at the root of the directory it describes, so every
 * listing that skips dotfiles ignores it without knowing it exists. Since D51
 * it is **required** rather than merely evidence of an explicit create: it is
 * where the ULID lives, and a directory without one is not a record.
 */
export class FsMarker {
  /**
   * Written only when absent, mirroring SQLite's `INSERT OR IGNORE`: creating
   * a record that exists must not reset its id or its recorded creation time.
   */
  static async write(filePath: string, id: string): Promise<FsMarkerData> {
    const existing = await FsMarker.read(filePath);
    if (existing) return existing;

    const created = EntryUtils.now();
    await FsMarker.replace(filePath, { id, created_at: created });
    return { id, created_at: created };
  }

  /** Writes the marker whatever is already there, for the rename phases. */
  static async replace(filePath: string, data: FsMarkerData): Promise<void> {
    const document: Record<string, unknown> = {
      id: data.id,
      created_at: data.created_at.toISOString(),
    };
    if (data.moving_from !== undefined) document.moving_from = data.moving_from;
    await FsFiles.writeAtomic(filePath, JSON.stringify(document));
  }

  /**
   * Null when the marker is absent, torn or hand-edited past recognition.
   *
   * A marker with no usable `id` is treated as absent rather than repaired with
   * a fresh one: minting here would give the same record a different identity on
   * every process that read it.
   */
  static async read(filePath: string): Promise<FsMarkerData | null> {
    const document = await FsFiles.readJsonOrNull(filePath);
    if (!document || typeof document.id !== "string" || document.id.length === 0) return null;

    const created =
      typeof document.created_at === "string" ? new Date(document.created_at) : EntryUtils.now();
    return {
      id: document.id,
      created_at: Number.isNaN(created.getTime()) ? EntryUtils.now() : created,
      moving_from:
        typeof document.moving_from === "string" ? document.moving_from : undefined,
    };
  }
}
