/**
 * Where a trashed thing was, held by id **and** by name (D113).
 *
 * The ids are what a restore anchors on, because a name is mutable (D51) and a
 * rename between delete and restore would otherwise misfile the content. The
 * names stored are the ones at delete time; `TrashService` hands every reader
 * today's (`TrashLocator.currentNames`), and a stored name survives only for a
 * container that is gone, where the UI draws it greyed.
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
