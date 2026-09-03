/**
 * A collection as the listing answers it: what it is, how much it holds, and
 * when it moved — everything a navigation surface draws, and no schema.
 *
 * The schema is deliberately absent. It is the largest thing a collection
 * carries and the one thing a list of collections never renders, so a scope of
 * forty content types cost megabytes to draw a sidebar. `Collection` is the
 * shape with the schema, answered per collection by `.../collections/{name}/schema`
 * and in bulk by `.../schemas`.
 */
export interface CollectionSummary {
  id: string;
  name: string;
  /** How many entries it holds. */
  entries: number;
  /**
   * Whether reading it needs a key (`x-silo-auth`).
   *
   * Stated here because it is read off the schema, which this shape no longer
   * carries — and it is what decides both the listing's own visibility filter
   * and the badge the admin prints beside the name.
   */
  requires_auth: boolean;
  created_at: string;
  updated_at: string;
}
