/** One distinct `(project, env, collection)` a media force-delete's reach was
 *  found to touch — `MediaUsage` reduced to the scope it names, deduplicated
 *  (D49). */
export interface MediaUsageScope {
  project: string;
  env: string;
  collection: string;
}
