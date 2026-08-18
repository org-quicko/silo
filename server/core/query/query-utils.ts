import { ValidationError } from "@silo/shared/validation-error";
import { DefaultLimit, MaxLimit, MaxFilterDepth, MaxFilterNodes, type Query } from "./query";
import type { Filter } from "./filter";
import type { SortKey } from "./sort-key";

export class QueryUtils {
  private static readonly leafOps = new Set([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "contains",
  ]);

  private static readonly envelopeFields = new Set([
    "$id",
    "$created_at",
    "$updated_at",
    "$seq",
    "$rev",
  ]);

  private static readonly fieldRe = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

  static isEnvelopeField(f: string): boolean {
    return QueryUtils.envelopeFields.has(f);
  }

  static validField(f: string): boolean {
    return QueryUtils.isEnvelopeField(f) || QueryUtils.fieldRe.test(f);
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
        if (!QueryUtils.validField(s.field)) {
          throw new ValidationError(`invalid sort field "${s.field}"`);
        }
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
      const field = desc ? trimmed.slice(1) : trimmed;
      keys.push({ field, desc });
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

    if (f.op === "and" || f.op === "or") {
      if (!f.args || f.args.length === 0) {
        throw new ValidationError(`op "${f.op}" requires args`);
      }
      if (f.field != null || f.value !== undefined) {
        throw new ValidationError(`op "${f.op}" takes args, not field/value`);
      }
      for (const arg of f.args) {
        QueryUtils.validateFilter(arg, depth + 1, state);
      }
    } else if (QueryUtils.leafOps.has(f.op)) {
      if (!f.field || !QueryUtils.validField(f.field)) {
        throw new ValidationError(`invalid filter field "${f.field || ""}"`);
      }
      if (f.args && f.args.length > 0) {
        throw new ValidationError(`op "${f.op}" takes field/value, not args`);
      }
      if (f.op === "in") {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          throw new ValidationError(`op "in" requires a non-empty array value`);
        }
      }
    } else {
      throw new ValidationError(`unknown filter op "${f.op}"`);
    }
  }
}
