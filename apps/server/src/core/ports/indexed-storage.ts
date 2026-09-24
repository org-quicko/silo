import type { Searcher } from "../search/searcher";
import type { Storage } from "./storage";

/**
 * A `Storage` that keeps a search index inside its own writes (D30), and so
 * can offer a native engine over it.
 *
 * Optional, and asked of the store rather than of its class, so the runtime
 * names no adapter (D92). A store without it is searched by `ScanSearcher`.
 * It is not on `Storage` itself because a scaffolded provider stubs every port
 * method to throw, and these are called at startup.
 */
export interface IndexedStorage extends Storage {
  /** The native engine, or null when this store has none to offer right now
   *  (search switched off, or the engine missing from this build). */
  createSearcher(): Searcher | null;

  /** True when the index is missing or stale, so it must be rebuilt before the
   *  server answers a search. */
  needsSearchRebuild(): boolean;

  /** Records that the rebuild `needsSearchRebuild` asked for has run. */
  searchRebuilt(): void;
}
