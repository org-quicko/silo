import type { Entry } from "../domain/entry";
import type { SearchSnippet } from "./search-snippet";

/**
 * One result. The location sits on the **hit**, never on the entry: §5.1 keeps
 * `project`/`env` out of an entry response, and this is the deliberate
 * exception D30 records — a client cannot link to a result whose location it
 * cannot see, and the access plan has already bounded the disclosure to
 * targets the caller may read.
 */
export interface SearchHit {
  project: string;
  env: string;
  collection: string;
  entry: Entry;
  snippets: SearchSnippet[];
}
