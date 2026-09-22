import type { Entry } from "../domain/entry";
import type { MediaAsset } from "../media/media-asset";
import type { TrashKind } from "./trash-kind";

/**
 * An entry as it was, addressed by the **ids** of its containers rather than
 * their names, so a rename between delete and restore cannot misfile it. The
 * restorer resolves each id back to a current name before writing.
 */
export interface TrashedEntry {
  id: string;
  project_id: string;
  env_id: string;
  collection_id: string;
  rev: number;
  created_at: string;
  updated_at: string;
  data: unknown;
}

/** A `_media` document as it was. The blob is untouched by a trash and is
 *  destroyed only by a purge. */
export interface TrashedAsset extends MediaAsset {
  id: string;
  created_at: string;
}

/** One parked record — a `_trash_items` document in `Scope.System` (D91).
 *  `record` is a `ProjectRecord`, `EnvironmentRecord`, `CollectionRecord`,
 *  `TrashedEntry`, `TrashedAsset` or `{ path }`, per `kind`. */
export interface TrashItem {
  /** The receipt this belongs to; the only filter the restore path needs. */
  trash_id: string;
  kind: TrashKind;
  record: unknown;
}

export class TrashItemUtils {
  /**
   * Needs the container ids, which the entry envelope carries as names (D18).
   * The caller already resolved them to reach the entry, so it passes them in
   * rather than making this look them up again.
   */
  static toTrashedEntry(
    entry: Entry,
    ids: { project_id: string; env_id: string; collection_id: string }
  ): TrashedEntry {
    return {
      id: entry.id,
      project_id: ids.project_id,
      env_id: ids.env_id,
      collection_id: ids.collection_id,
      rev: entry.rev,
      created_at: TrashItemUtils.iso(entry.created_at),
      updated_at: TrashItemUtils.iso(entry.updated_at),
      data: entry.data,
    };
  }

  static iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
