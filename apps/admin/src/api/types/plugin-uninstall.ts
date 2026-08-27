/**
 * What `DELETE /api/plugins/{name}` reports (D43).
 *
 * Four flags rather than a success boolean, because a plugin lives in four
 * places and an uninstall may legitimately touch fewer than all of them — a
 * package that was never listed, or never loaded, or already gone from disk.
 * The screen that reports it says which, so "uninstalled" never has to stand in
 * for four different outcomes.
 */
export interface PluginUninstallResponse {
  name: string
  /** What the record held at the moment it went. Nothing else records this
   *  once the record is deleted, so it is worth showing. */
  withdrawn: string[]
  unlisted: boolean
  forgotten: boolean
  removed: boolean
  /** Anything that could not be finished but did not stop the uninstall —
   *  files a running process still had open, in practice. */
  warnings: string[]
}
