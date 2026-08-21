import type { Entry } from "../../../core/domain/entry";
import { EntryNodes } from "../../../core/query/entry-nodes";
import { QueryUtils } from "../../../core/query/query-utils";
import type { Filter } from "../../../core/query/filter";

/**
 * The in-memory half of the query engine. It answers the same questions the
 * SQLite compiler answers in SQL, from the same parsed paths (D29) — the
 * shared `JsonPath` and `EntryNodes` are what keep the two from drifting,
 * since neither re-derives what a path means or what it selects.
 */
export class FsFilter {
  static evaluateFilter(e: Entry, f: Filter): boolean {
    if (f.op === "and") {
      for (const arg of f.args!) {
        if (!FsFilter.evaluateFilter(e, arg)) return false;
      }
      return true;
    }
    if (f.op === "or") {
      for (const arg of f.args!) {
        if (FsFilter.evaluateFilter(e, arg)) return true;
      }
      return false;
    }
    if (f.op === "not") {
      return !FsFilter.evaluateFilter(e, f.args![0]);
    }

    const nodes = EntryNodes.select(e, QueryUtils.path(f.path));

    // ANY over zero nodes is false, for every operator (D29). `some` gives
    // that for free — the rule is the absence of a special case, not one.
    switch (f.op) {
      case "exists":
        return nodes.length > 0;
      case "eq":
        return nodes.some((n) => n === f.value);
      case "neq":
        return nodes.some((n) => n !== f.value);
      case "gt":
        return nodes.some((n) => FsFilter.greater(n, f.value, false));
      case "gte":
        return nodes.some((n) => FsFilter.greater(n, f.value, true));
      case "lt":
        return nodes.some((n) => FsFilter.less(n, f.value, false));
      case "lte":
        return nodes.some((n) => FsFilter.less(n, f.value, true));
      case "in":
        return (
          Array.isArray(f.value) && nodes.some((n) => f.value.some((v: any) => n === v))
        );
      case "contains":
        // Substring on a string only (D29). Array membership is `eq` over a
        // `[*]` path, so this operator needs no array branch.
        return nodes.some((n) => typeof n === "string" && n.includes(f.value));
    }
    return false;
  }

  private static greater(actual: any, expected: any, orEqual: boolean): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      return orEqual ? actual >= expected : actual > expected;
    }
    if (typeof actual === "string" && typeof expected === "string") {
      return orEqual ? actual >= expected : actual > expected;
    }
    return false;
  }

  private static less(actual: any, expected: any, orEqual: boolean): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      return orEqual ? actual <= expected : actual < expected;
    }
    if (typeof actual === "string" && typeof expected === "string") {
      return orEqual ? actual <= expected : actual < expected;
    }
    return false;
  }
}
