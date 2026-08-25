/** What `POST /api/plugins/rescan` did (D39). A plugin nothing changed is left
 *  running, which is why `unchanged` is a list rather than an omission. */
export interface RescanReport {
  started: string[]
  restarted: string[]
  stopped: string[]
  unchanged: string[]
  skipped: string[]
  failed: { name: string; error: string }[]
  /** The dispatch order after the rescan, which is `silo.toml`'s order. */
  order: string[]
}
