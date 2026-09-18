import type { ImportGrants } from "./import-grants";
import type { ImportLimits } from "./import-limits";
import type { ImportProgressReporter } from "./import-progress";
import type { MediaMode } from "./media-mode";
import type { TransferSelection } from "./transfer-selection";

export interface ImportOptions {
  mode?: "merge" | "replace";
  dryRun?: boolean;
  prefer?: "local" | "remote";
  /**
   * What of the archive's `_system` half this caller may load (D84): keys, the
   * media catalog, and variables per project. Absent means trusted — the CLI
   * on the host, or a test — and the HTTP routes always derive one from the
   * caller's claims.
   */
  grants?: ImportGrants;
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
  /** How large a streamed archive may be and how much it may expand to
   *  (D85). Absent means unbounded, which only a file on the host earns. */
  limits?: ImportLimits;
  /** Bound scope-copy dry-run detail; normal archive imports leave it absent. */
  scopeCopyPreview?: {
    offset: number;
    limit: number;
    includeDestinationDetails: boolean;
  };
}
