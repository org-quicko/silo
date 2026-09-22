/**
 * Where a trashed thing was, held by id **and** by name (D91).
 *
 * The ids are what a restore anchors on, because a name is mutable (D51) and a
 * rename between delete and restore would otherwise misfile the content. The
 * names are what the UI draws, and are allowed to go stale — a stale name
 * renders greyed rather than wrong.
 */
export interface TrashOrigin {
  project_id?: string;
  project_name?: string;
  env_id?: string;
  env_name?: string;
  collection_id?: string;
  collection_name?: string;
  /** Media only: the normalised "/a/b" library path. */
  folder?: string;
}
