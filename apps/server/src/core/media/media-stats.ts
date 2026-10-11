import type { MediaKindName } from "./media-kind";

/** Counts and sizes across the whole library, as `GET /api/media/stats` answers them. */
export interface MediaStats {
  files: number;
  bytes: number;
  folders: number;
  /** Largest share first; a kind the library holds none of is left out. */
  types: Array<{ type: MediaKindName; files: number; bytes: number }>;
  largest: { id: string; filename: string; folder: string; size: number } | null;
  last_upload: string | null;
  /** Files staged for deletion, left out of every figure above. */
  deleting: number;
}
