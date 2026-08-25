/**
 * What a rescan did (D39, phase 4).
 *
 * Every plugin named in `silo.toml` appears in exactly one of these lists, which
 * is the property that makes the report readable: an operator who edited the
 * file can check that what they changed is where they expected it, rather than
 * inferring it from what is *absent*. `silo plugin doctor` reports the same
 * facts without applying them; this is doctor that takes effect.
 */
export interface RescanReport {
  /** Newly listed, and now running. */
  started: string[];
  /** Already running, and torn down and started again because something it was
   *  started with changed — its config, its claims block, or the package. */
  restarted: string[];
  /** Running before, and no longer listed. */
  stopped: string[];
  /** Running before and after, untouched. Its authority may still have been
   *  refreshed, which needs no restart. */
  unchanged: string[];
  /** Listed and deliberately not running: disabled, or a provider, which is
   *  the storage and cannot be swapped underneath an open database. */
  skipped: { name: string; reason: string }[];
  /**
   * Listed and could not be loaded.
   *
   * A rescan does **not** refuse itself over one of these, unlike a start. The
   * difference is what refusing would cost: a `serve` that refuses leaves the
   * operator where they were, while a rescan that refused would abandon every
   * other change in the file to a plugin they may not even have touched. Each
   * failure is reported, that plugin is left not running, and the next `serve`
   * will still refuse to start until it is fixed — which the report says.
   */
  failed: { name: string; error: string }[];
  /** The dispatch order after the rescan, which is `silo.toml`'s order. Named
   *  explicitly because reordering leaves every other list empty, and a report
   *  that showed nothing would look like a rescan that did nothing. */
  order: string[];
}
