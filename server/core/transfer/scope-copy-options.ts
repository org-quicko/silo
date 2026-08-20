export interface ScopeCopyOptions {
  mode?: "merge" | "replace";
  dryRun?: boolean;
  validate?: boolean;
  prefer?: "local" | "remote";
}
