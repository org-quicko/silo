/**
 * One (project, env, collection) triple a request may read. Any segment may be
 * `"*"`, which is how a wildcard claim reaches collections that do not exist
 * yet.
 */
export interface SearchTarget {
  project: string;
  env: string;
  collection: string;
}
