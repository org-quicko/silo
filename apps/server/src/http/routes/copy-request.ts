import type { MediaMode } from "../../core/transfer/media-mode";

export interface CopyRequest {
  source_url: string;
  source_api_key: string;
  mode?: "merge" | "replace";
  with_keys?: boolean;
  dry_run?: boolean;
  prefer?: "local" | "remote";
  /**
   * `project[/env[/collection]]` rules, as `GET /api/export?include=` spells
   * them. Forwarded to the source so it narrows its own walk, and applied again
   * on the way in so the destination never loads more than it asked for.
   */
  include?: string[];
  /** What to do about the source's media bytes (§7.7). */
  media?: MediaMode;
}
