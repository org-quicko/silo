import type { Entry } from "../entries/entry.js";
import type { SearchSnippet } from "./search-snippet.js";

/**
 * One result. The location sits on the hit rather than on the entry, which is
 * what lets a caller link to a result found outside the scope on screen, and
 * `environment` is mapped from the wire's `env`.
 *
 * The entry is untyped: a result is not addressed to one collection, so there
 * is no `Fields` to give it. Its `{{NAME}}` templates are resolved, so read it
 * again through `collection.get(id, { variables: "raw" })` before editing.
 */
export interface SearchHit {
  readonly project: string;
  readonly environment: string;
  readonly collection: string;
  readonly entry: Entry;
  readonly snippets: readonly SearchSnippet[];
}
