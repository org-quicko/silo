/**
 * One entry exactly as the wire answers it: flattened, with the user's
 * fields alongside the four envelope keys. `EntryUtils.toApiResponse` is
 * where the server builds this shape.
 */
export interface EntryPayload {
  id: string;
  rev: number;
  created_at: string;
  updated_at: string;
  [field: string]: unknown;
}
