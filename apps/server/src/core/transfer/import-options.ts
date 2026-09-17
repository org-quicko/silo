import type { ImportProgressReporter } from "./import-progress";
import type { MediaMode } from "./media-mode";
import type { TransferSelection } from "./transfer-selection";

export interface ImportOptions {
  mode?: "merge" | "replace";
  dryRun?: boolean;
  prefer?: "local" | "remote";
  allowKeys?: boolean;
  /**
   * What of the archive to load, named after the `include` parameter that
   * carries it. Absent, or `Everything`, loads all of it.
   *
   * It narrows **content** — projects, environments, collections — and the
   * variable declarations that belong to the projects it drops. The media
   * catalog rides as the archive holds it, because the archive is already the
   * product of an export that made that choice and re-deriving it here would be
   * a second implementation of the same rule (§7.7).
   */
  include?: TransferSelection;
  /** `none` ignores the archive's media bytes entirely. Absent takes the
   *  default for the selection's breadth. */
  media?: MediaMode;
  /**
   * Called as the import advances, for a caller streaming progress back.
   *
   * Absent for every in-process caller; the HTTP routes pass one only when the
   * request asked for a progress stream (§7.8).
   */
  onProgress?: ImportProgressReporter;
  /** Where a streamed archive is unpacked. Absent uses the platform temp
   *  directory, which is frequently the wrong disk (§7.2). */
  stagingDirectory?: string;
  /** Bound scope-copy dry-run detail; normal archive imports leave it absent. */
  scopeCopyPreview?: {
    offset: number;
    limit: number;
    includeDestinationDetails: boolean;
  };
}
