export interface ScopeCopyRequest {
  from: { project: string; env: string };
  mode?: "merge" | "replace";
  dry_run?: boolean;
  validate?: boolean;
  prefer?: "local" | "remote";
}
