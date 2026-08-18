import type { Entry } from "../../../core/domain/entry";
import { QueryUtils } from "../../../core/query/query-utils";

export class FsFilter {
  static getFieldValue(e: Entry, field: string): any {
    switch (field) {
      case "$id":
        return e.id;
      case "$created_at":
        return e.created_at.toISOString();
      case "$updated_at":
        return e.updated_at.toISOString();
      case "$seq":
        return e.seq;
      case "$rev":
        return e.rev;
    }

    const parts = field.split(".");
    let curr = e.data;
    for (const part of parts) {
      if (curr === null || typeof curr !== "object") {
        return undefined;
      }
      curr = curr[part];
    }
    return curr;
  }

  static evaluateFilter(e: Entry, f: any): boolean {
    if (f.op === "and") {
      for (const arg of f.args) {
        if (!FsFilter.evaluateFilter(e, arg)) return false;
      }
      return true;
    }
    if (f.op === "or") {
      for (const arg of f.args) {
        if (FsFilter.evaluateFilter(e, arg)) return true;
      }
      return false;
    }

    const val = FsFilter.getFieldValue(e, f.field);
    const exists = val !== undefined;

    switch (f.op) {
      case "eq":
        if (!exists) return f.value === null || f.value === undefined;
        return FsFilter.compareEq(val, f.value);
      case "neq":
        if (!exists) return f.value !== null && f.value !== undefined;
        return !FsFilter.compareEq(val, f.value);
      case "gt":
        if (!exists) return false;
        return FsFilter.compareGreater(val, f.value, false);
      case "gte":
        if (!exists) return false;
        return FsFilter.compareGreater(val, f.value, true);
      case "lt":
        if (!exists) return false;
        return FsFilter.compareLess(val, f.value, false);
      case "lte":
        if (!exists) return false;
        return FsFilter.compareLess(val, f.value, true);
      case "in": {
        if (!exists) return false;
        if (!Array.isArray(f.value)) return false;
        return f.value.some((v: any) => FsFilter.compareEq(val, v));
      }
      case "contains": {
        if (!exists) return false;
        if (QueryUtils.isEnvelopeField(f.field)) {
          return typeof val === "string" && val.includes(f.value);
        }
        if (Array.isArray(val)) {
          return val.some((item) => FsFilter.compareEq(item, f.value));
        }
        if (typeof val === "string") {
          return val.includes(f.value);
        }
        return false;
      }
    }
    return false;
  }

  private static compareEq(actual: any, expected: any): boolean {
    if (actual === null || actual === undefined || expected === null || expected === undefined) {
      return actual === expected;
    }
    return actual === expected;
  }

  private static compareGreater(actual: any, expected: any, orEqual: boolean): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      return orEqual ? actual >= expected : actual > expected;
    }
    if (typeof actual === "string" && typeof expected === "string") {
      return orEqual ? actual >= expected : actual > expected;
    }
    return false;
  }

  private static compareLess(actual: any, expected: any, orEqual: boolean): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      return orEqual ? actual <= expected : actual < expected;
    }
    if (typeof actual === "string" && typeof expected === "string") {
      return orEqual ? actual <= expected : actual < expected;
    }
    return false;
  }

  static compareValues(a: any, b: any): number {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
    if (b === null || b === undefined) return 1;

    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b);
    }
    if (typeof a === "boolean" && typeof b === "boolean") {
      return a === b ? 0 : a ? 1 : -1;
    }
    return 0;
  }
}
