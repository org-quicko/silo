import { ValidationError } from "@silo/shared/validation-error";
import type { SortKey } from "../../query/sort-key";

/** The `?sort=` grammar for the media catalog: a field name, optionally
 *  prefixed with `-` for descending. */
export class MediaSortOrder {
  private static readonly Fields: Record<string, string> = {
    created_at: "$.created_at",
    updated_at: "$.updated_at",
    filename: "$.data.filename",
    size: "$.data.size",
  };

  static readonly Default = "-created_at";

  static parse(sort?: string): SortKey[] {
    const raw = (sort || MediaSortOrder.Default).trim();
    const desc = raw.startsWith("-");
    const name = desc ? raw.slice(1) : raw;

    // `Object.hasOwn`, not a bare lookup: `name` is caller-supplied, so
    // `?sort=constructor` would otherwise find an inherited key and pass the
    // check below with a function where a path belongs.
    const path = Object.hasOwn(MediaSortOrder.Fields, name)
      ? MediaSortOrder.Fields[name]
      : undefined;
    if (!path) {
      const allowed = Object.keys(MediaSortOrder.Fields).join(", ");
      throw new ValidationError(
        `invalid media sort "${raw}"; expected one of ${allowed} with an optional "-" prefix`
      );
    }
    return [{ path, desc }];
  }
}
