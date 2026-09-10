import { FieldPath } from "./field-path.js";
import { SortTerm } from "./sort-term.js";

/**
 * Sort statics. No `each`, deliberately: a sort path must select at most one
 * node, so there is no wildcard variant to offer.
 */
export class Sort {
  static by(name: string): SortTerm {
    return new SortTerm(FieldPath.field(name));
  }

  static meta(name: string): SortTerm {
    return new SortTerm(FieldPath.meta(name));
  }

  /** Sorts on `updated_at`, most recent first. Named for the field, not a
   *  vague idea of recency — `recentlyCreated` is a different order. */
  static recentlyUpdated(): SortTerm {
    return Sort.meta("updated_at").descending();
  }

  static recentlyCreated(): SortTerm {
    return Sort.meta("created_at").descending();
  }

  /** Joins terms with a comma: what the `sort` query parameter wants. */
  static of(...terms: SortTerm[]): string {
    return terms.map((term) => term.toString()).join(",");
  }
}
