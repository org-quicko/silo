/** Ascending unless `descending()` was called. */
export type SortDirection = "asc" | "desc";

/** One sort key: a path plus a direction. Stringifies to what the `sort`
 *  query parameter wants — the path alone when ascending, `-`-prefixed when
 *  descending. */
export class SortTerm {
  constructor(
    private readonly path: string,
    private readonly direction: SortDirection = "asc",
  ) {}

  ascending(): SortTerm {
    return new SortTerm(this.path, "asc");
  }

  descending(): SortTerm {
    return new SortTerm(this.path, "desc");
  }

  toString(): string {
    return this.direction === "desc" ? `-${this.path}` : this.path;
  }
}
