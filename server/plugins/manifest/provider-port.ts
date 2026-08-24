/**
 * Which port a provider plugin fills (D31/§13.7).
 *
 * `Searcher` is deliberately **absent**, though it is a port like the other
 * two. Nothing selects a searcher by name — `[search]` has no `driver` key and
 * `Cli` picks the engine from the store's own type — so the value would name a
 * capability with no path behind it, which is the speculative interface D7
 * rejects.
 *
 * The deeper reason it is not merely unwired: D30 keeps `SqliteSearcher`'s
 * index *inside* `SqliteStore`, maintained by triggers in the same transactions
 * as `put`/`delete`/`deleteProject`, for the reason D23 gives about usages —
 * nothing above the port can be atomic with a bulk delete. An external engine is
 * outside that transaction by definition, so it could only be fed by
 * `entry.afterWrite`, which is best-effort and at-most-once. A search index that
 * silently drifts makes content unfindable and says nothing, so the honest
 * prerequisite is the change feed (§12.1), not a config key.
 *
 * Adding a value back is additive; removing one after 1.0 froze the manifest
 * would not be.
 */
export type ProviderPort = "storage" | "blob";
