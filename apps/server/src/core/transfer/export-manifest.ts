import type { MediaMode } from "./media-mode";

/** What an archive says about its own media, so a partial one cannot be
 *  mistaken for a complete one. */
export interface ExportMediaManifest {
  mode: MediaMode;
  /** Distinct assets the exported entries reference. */
  referenced: number;
  /** Catalog rows the archive carries. */
  catalogued: number;
  /** Blobs whose bytes the archive actually carries. Below `catalogued`
   *  whenever the mode left bytes behind. */
  files: number;
}

export interface ExportManifest {
  format_version: string;
  instance_id: string;
  last_seq: number;
  exported_at?: string;
  silo_version?: string;
  // Keyed by "<project>/<env>/<collection>" (D18) — one entry per scoped
  // collection actually written to the archive.
  collections?: Record<string, number>;
  /**
   * The selection this archive was taken under, as `project[/env[/collection]]`
   * rules. **Absent means the whole instance** — the difference matters to
   * replace mode, which may only clear what the archive is authoritative for.
   */
  selection?: string[];
  /** Absent only in archives written before §7.7. */
  media?: ExportMediaManifest;
}
