import type { ResolvedEntry } from "../entries/resolved-entry.js";
import type { SearchSnippet } from "./search-snippet.js";

/**
 * One result. The location sits on the hit rather than on the entry, which is
 * what lets a caller link to a result found outside the scope on screen, and
 * `environment` is mapped from the wire's `env`.
 *
 * The entry is always a `ResolvedEntry`: a result is not addressed to one
 * typed collection, so there is no `Fields` to give it, and it is not meant to
 * be edited from here — re-read through `collection.edit()` for that.
 */
export interface SearchHit {
  readonly project: string;
  readonly environment: string;
  readonly collection: string;
  readonly entry: ResolvedEntry<unknown>;
  readonly snippets: readonly SearchSnippet[];
}
