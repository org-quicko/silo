/**
 * A catalogued media asset exactly as the wire answers it — the body
 * `GET/POST/PATCH /api/media[/…]` sends for one asset, and `MediaAssetMapper`
 *'s input.
 */
export interface MediaAssetPayload {
  id: string;
  filename: string;
  folder: string;
  blob_key: string;
  size: number;
  content_type: string;
  hash: string;
  state: "active" | "deleting";
  tags: string[];
  url: string;
  created_at: string;
  updated_at: string;
  usage_count?: number;
}
