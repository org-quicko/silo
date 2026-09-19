/**
 * How large an archive arriving over the network may be, and how much it may
 * expand to (D85). See §10.5 in
 * [docs/design/configuration.md](../../../../docs/design/configuration.md).
 *
 * Both bound `POST /api/import` and the export `POST /api/copy` pulls. A
 * tarball or directory named on the host's own command line is the operator's
 * and is not bounded.
 */
export interface TransferConfig {
  /**
   * Megabytes the archive itself may weigh. An upload is also held to
   * `[http] max_body_size_mb`, which is normally the lower of the two; a copy
   * has no request body and this is its only ceiling.
   */
  max_archive_size_mb: number;

  /**
   * Megabytes the tree the archive expands to may cost on disk, counted from
   * the tar headers before anything is written, with every entry costing at
   * least one 4 KB block so a million empty files are refused as well.
   */
  max_extracted_size_mb: number;
}
