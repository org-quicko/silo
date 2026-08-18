export interface ImportOptions {
  mode?: "merge" | "replace";
  dryRun?: boolean;
  validate?: boolean;
  prefer?: "local" | "remote";
  allowKeys?: boolean;
}
