/**
 * Which port a provider plugin fills (D31/§13.7).
 *
 * `Searcher` is deliberately **absent**: nothing selects a searcher by name,
 * and an external engine could only be fed by a best-effort hook, so a search
 * index would silently drift. See `docs/design/plugins.md`.
 *
 * Adding a value back is additive; removing one after 1.0 froze the manifest
 * would not be.
 */
export type ProviderPort = "storage" | "blob";
