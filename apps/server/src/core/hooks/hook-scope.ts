/** The scope a hook event belongs to, flattened to plain data because the
 *  payload may cross a structured-clone boundary (§13.4). */
export interface HookScope {
  project: string;
  env: string;
}
