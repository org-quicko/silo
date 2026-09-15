export interface ImportOptions {
  mode?: "merge" | "replace";
  dryRun?: boolean;
  validate?: boolean;
  prefer?: "local" | "remote";
  allowKeys?: boolean;
  /** Bound scope-copy dry-run detail; normal archive imports leave it absent. */
  scopeCopyPreview?: {
    offset: number;
    limit: number;
    includeDestinationDetails: boolean;
  };
}
