import { ValidationError } from "@silo/shared/validation-error";
import { JsonPath } from "@silo/shared/json-path";
import { DefaultLimit, MaxLimit, MaxFilterDepth, MaxFilterNodes, type Query } from "./query";
import type { Filter } from "@silo/shared/filter";
import { FilterOps } from "@silo/shared/filter-ops";
import type { SortKey } from "./sort-key";

export class QueryUtils {

  /** Parses and validates a filter path, raising `ValidationError` (D29). */
  static path(raw: string | undefined): JsonPath {
    if (!raw) {
      // Reached by anything that omits `path` — including the pre-D29 `field`
      // spelling, which is not detected on purpose (D29) but still deserves an
      // error that names what the op actually wants.
      throw new ValidationError(
        'every leaf op needs a "path", an RFC 9535 path such as "$.data.title" or "$.updated_at"'
      );
    }
    return JsonPath.parse(raw);
  }

  /**
   * A sort key must select at most one node — a wildcard path has no
   * deterministic order, so it is refused here rather than producing an
   * arbitrary one that differs per adapter.
   */
  static sortPath(raw: string): JsonPath {
    const p = JsonPath.parse(raw);
    if (!p.singular) {
      throw new ValidationError(
        `invalid sort path "${raw}": a wildcard selects many nodes and has no deterministic order`
      );
    }
    return p;
  }

  static normalizeQuery(q: Partial<Query>): Query {
    const normalized: Query = {
      limit: q.limit ?? DefaultLimit,
      offset: q.offset ?? 0,
      filter: q.filter,
      sort: q.sort,
    };

    if (normalized.filter) {
      const state = { nodes: 0 };
      QueryUtils.validateFilter(normalized.filter, 0, state);
    }

    if (normalized.sort) {
      for (const s of normalized.sort) {
        QueryUtils.sortPath(s.path);
      }
    }

    if (normalized.limit <= 0) {
      normalized.limit = DefaultLimit;
    }
    if (normalized.limit > MaxLimit) {
      normalized.limit = MaxLimit;
    }
    if (normalized.offset < 0) {
      normalized.offset = 0;
    }

    return normalized;
  }

  static parseSort(s: string): SortKey[] {
    const keys: SortKey[] = [];
    if (!s) return keys;
    for (const part of s.split(",")) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      const desc = trimmed.startsWith("-");
      const path = desc ? trimmed.slice(1) : trimmed;
      keys.push({ path, desc });
    }
    return keys;
  }

  private static validateFilter(f: Filter, depth: number, state: { nodes: number }): void {
    if (depth > MaxFilterDepth) {
      throw new ValidationError("filter nested too deeply");
    }
    state.nodes++;
    if (state.nodes > MaxFilterNodes) {
      throw new ValidationError(
        `filter has too many conditions (max ${MaxFilterNodes})`
      );
    }

    if (FilterOps.isGroup(f.op)) {
      if (!f.args || f.args.length === 0) {
        throw new ValidationError(`op "${f.op}" requires args`);
      }
      // `not` negates one completed predicate. Allowing a list would leave its
      // meaning open — "none of" or "not all of" — so the arity is pinned
      // instead of guessed.
      if (f.op === "not" && f.args.length !== 1) {
        throw new ValidationError(`op "not" takes exactly one arg`);
      }
      if (f.path != null || f.value !== undefined) {
        throw new ValidationError(`op "${f.op}" takes args, not path/value`);
      }
      for (const arg of f.args) {
        QueryUtils.validateFilter(arg, depth + 1, state);
      }
      return;
    }

    if (!FilterOps.isLeaf(f.op)) {
      throw new ValidationError(`unknown filter op "${f.op}"`);
    }

    QueryUtils.path(f.path);

    if (f.args && f.args.length > 0) {
      throw new ValidationError(`op "${f.op}" takes path/value, not args`);
    }
    if (f.op === "exists") {
      if (f.value !== undefined) {
        throw new ValidationError(`op "exists" takes a path only, not a value`);
      }
      return;
    }
    if (f.op === "in") {
      if (!Array.isArray(f.value) || f.value.length === 0) {
        throw new ValidationError(`op "in" requires a non-empty array value`);
      }
      for (const v of f.value) QueryUtils.assertScalar(f.op, v);
      return;
    }
    QueryUtils.assertScalar(f.op, f.value);
  }

  /**
   * Comparison values are scalars. An object or array here has no consistent
   * answer: the in-memory evaluator would compare by reference and always say
   * false, while SQLite cannot bind it at all — so the two engines would
   * disagree by throwing versus quietly returning nothing.
   */
  private static assertScalar(op: string, v: any): void {
    if (v === null) return;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return;
    throw new ValidationError(
      `op "${op}" requires a string, number, boolean or null value, not ${Array.isArray(v) ? "an array" : t}`
    );
  }
}
