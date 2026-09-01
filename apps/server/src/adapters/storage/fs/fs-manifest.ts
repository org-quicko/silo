export interface FsManifest {
  format_version: string;
  instance_id: string;
  last_seq: number;
  /** Whether the configured defaults have ever been seeded (D51). Absent in a
   *  manifest written before it existed, which reads as `false`. */
  defaults_initialized?: boolean;
}
