export interface CopyRequest {
  source_url: string;
  source_api_key: string;
  mode?: "merge" | "replace";
  with_keys?: boolean;
  dry_run?: boolean;
  validate?: boolean;
  prefer?: "local" | "remote";
}
