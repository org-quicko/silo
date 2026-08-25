import type { MediaAsset } from "./media-asset";

/**
 * A catalogued asset as the API returns it — the stored record plus the parts
 * that live on the envelope rather than in the document (D23).
 *
 * `url` is derived, not stored: it addresses the asset by catalog id, so it
 * survives a rename or a move. `usage_count` is present only where the caller
 * asked for it, because counting is a storage query the listing pays for once
 * and a detail fetch pays for per asset.
 */
export interface MediaAssetView extends MediaAsset {
  id: string;
  url: string;
  created_at: string;
  updated_at: string;
  usage_count?: number;
}
