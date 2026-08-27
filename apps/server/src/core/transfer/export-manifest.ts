export interface ExportManifest {
  format_version: string;
  instance_id: string;
  last_seq: number;
  exported_at?: string;
  silo_version?: string;
  // Keyed by "<project>/<env>/<collection>" (D18) — one entry per scoped
  // collection actually written to the archive.
  collections?: Record<string, number>;
}
