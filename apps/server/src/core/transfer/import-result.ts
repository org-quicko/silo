export interface ImportResult {
  mode: string;
  dry_run: boolean;
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
}
