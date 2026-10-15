/** What a trash receipt stands for (D113). */
export type TrashKind =
  | 'project'
  | 'environment'
  | 'collection'
  | 'entry'
  | 'media'
  | 'media_folder'

/** Where the thing was, by id and by name. Names are today's, except for a
 *  container that is gone, which renders greyed; ids are what a restore
 *  anchors on. */
export interface TrashOrigin {
  project_id?: string
  project_name?: string
  env_id?: string
  env_name?: string
  collection_id?: string
  collection_name?: string
  folder?: string
}

/** What rode along, counted at delete time. */
export interface TrashContents {
  collections: number
  entries: number
  assets: number
  bytes: number
}

/** Who deleted it. silo authenticates keys, so "who" is a key. */
export interface TrashActor {
  kind: 'key' | 'cli' | 'system'
  id?: string
  label?: string
}

/** The container that has to come back first. `trash_id` is set when it is
 *  itself in the trash, which is what "Restore both" acts on. */
export interface TrashBlocker {
  kind: TrashKind
  name: string
  trash_id: string | null
}

/** One explicitly deleted thing, as the trash list shows it. */
export interface TrashItem {
  id: string
  kind: TrashKind
  origin: TrashOrigin
  subject_id: string
  subject_name: string
  deleted_at: string
  deleted_by: TrashActor
  /** Null when retention is off for this instance. */
  expires_at: string | null
  contents: TrashContents
  media_refs: string[]
  state: 'parking' | 'parked' | 'restoring' | 'purging'
  restorable: boolean
  blocked_by?: TrashBlocker
}
