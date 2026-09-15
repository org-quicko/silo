export interface ScopeCopyRequest {
  from: { project: string; env: string };
  mode?: "merge" | "replace";
  dry_run?: boolean;
  validate?: boolean;
  prefer?: "local" | "remote";
  detail_offset?: number;
  detail_limit?: number;
  /** Omit to copy the whole source scope. An item without ids copies its collection. */
  selection?: ScopeCopySelection[];
}

/** An explicit part of a source scope selected for copying. */
export interface ScopeCopySelection {
  collection: string;
  entry_ids?: string[];
}
