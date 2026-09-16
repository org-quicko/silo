/**
 * One entry an import refused, and why (D69).
 *
 * Reported rather than fatal. An archive is usually mostly good, and a source
 * instance that accepted this data under an older schema is the ordinary case
 * rather than a corrupt file — so one entry the destination's schema rejects
 * stops that entry and nothing else. The count and this list are what make the
 * gap visible; without them the destination would be quietly short of rows.
 */
export interface ImportRejection {
  project: string;
  env: string;
  collection: string;
  id: string;
  /** The validator's message, with its JSON Pointer paths appended. */
  reason: string;
}
