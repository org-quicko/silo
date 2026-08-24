import { ValidationError } from "@silo/shared/validation-error";
import { JsonPath } from "@silo/shared/json-path";
import type { PathSelector } from "@silo/shared/path-selector";
import { QueryUtils } from "../../../core/query/query-utils";
import type { Filter } from "@silo/shared/filter";
import type { SortKey } from "../../../core/query/sort-key";

/**
 * How a selected node is reached in SQL. Every leaf operator is written
 * against these three expressions rather than against a raw column, so the
 * envelope, a singular JSON path and a wildcard element all compile through
 * one set of rules (D29).
 */
interface NodeExpr {
  /** The node's value. */
  value: string;
  /** The node's JSON type name, for operators that are type-specific. */
  type: string;
  /** `1` when the node always exists; a predicate when it may not. */
  exists: string;
  args: any[];
}

export class SqliteCompiler {
  private static readonly cmpOps: Record<string, string> = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };

  /**
   * Envelope fields are columns, always present, with a known SQL type. Read
   * only through {@link SqliteCompiler.envelope} — a bare lookup would find
   * inherited keys like `constructor`, the hazard `Claims` documents.
   */
  private static readonly envelopeColumns: Record<string, { column: string; type: string }> = {
    id: { column: "id", type: "text" },
    rev: { column: "rev", type: "integer" },
    created_at: { column: "created_at", type: "text" },
    updated_at: { column: "updated_at", type: "text" },
  };

  private static envelope(root: string): { column: string; type: string } | undefined {
    return Object.hasOwn(SqliteCompiler.envelopeColumns, root)
      ? SqliteCompiler.envelopeColumns[root]
      : undefined;
  }

  static buildFilter(f: Filter): { cond: string; args: any[] } {
    if (f.op === "and" || f.op === "or") {
      if (!f.args || f.args.length === 0) {
        throw new ValidationError(`op "${f.op}" requires args`);
      }
      const joiner = f.op === "or" ? " OR " : " AND ";
      const parts: string[] = [];
      const args: any[] = [];

      for (const arg of f.args) {
        const res = SqliteCompiler.buildFilter(arg);
        parts.push("(" + res.cond + ")");
        args.push(...res.args);
      }
      return { cond: parts.join(joiner), args };
    }

    if (f.op === "not") {
      if (!f.args || f.args.length !== 1) {
        throw new ValidationError(`op "not" takes exactly one arg`);
      }
      const inner = SqliteCompiler.buildFilter(f.args[0]);
      // Never a bare `NOT`. SQL three-valued logic makes `NOT (x > 5)` drop
      // rows where x is NULL, so a bare negation would disagree with the
      // in-memory evaluator on exactly the missing fields a negation is
      // usually asked about (measured: 0 rows vs 2).
      return { cond: `NOT COALESCE((${inner.cond}), 0)`, args: inner.args };
    }

    const path = QueryUtils.path(f.path);
    return SqliteCompiler.leaf(path, f);
  }

  static buildOrder(sort: SortKey[]): { order: string; args: any[] } {
    const parts: string[] = [];
    const args: any[] = [];

    for (const k of sort) {
      const path = QueryUtils.sortPath(k.path);
      const envelope = SqliteCompiler.envelope(path.root);
      if (envelope) {
        parts.push(envelope.column + (k.desc ? " DESC" : ""));
        continue;
      }
      parts.push("json_extract(data, ?)" + (k.desc ? " DESC" : ""));
      args.push(SqliteCompiler.sqlitePath(path.selectors));
    }

    parts.push("id ASC");
    return { order: parts.join(", "), args };
  }

  /**
   * A leaf operator over a path that may select many nodes. The rule is one
   * line of D29 and the whole shape of this method: **a leaf is true when any
   * selected node satisfies it, and ANY over zero nodes is false.** Each
   * wildcard becomes one `EXISTS (SELECT 1 FROM json_each(...))`, which is
   * false for an empty array, a missing path, and a scalar alike.
   */
  private static leaf(path: JsonPath, f: Filter): { cond: string; args: any[] } {
    const envelope = SqliteCompiler.envelope(path.root);
    if (envelope) {
      return SqliteCompiler.apply(
        { value: envelope.column, type: `'${envelope.type}'`, exists: "1", args: [] },
        f
      );
    }

    const groups = SqliteCompiler.splitOnWildcards(path.selectors);
    if (groups.length === 1) {
      return SqliteCompiler.apply(SqliteCompiler.extract("data", groups[0]), f);
    }
    return SqliteCompiler.wildcard("data", groups, 0, f);
  }

  /**
   * Builds the nested `EXISTS` chain for a path with wildcards, innermost
   * predicate last. `json_each` yields no rows for a missing path or an empty
   * container, so the ANY-over-zero-nodes rule needs no extra guard — but it
   * *does* yield one row for a scalar, which RFC 9535 says a wildcard must
   * not select, so the type guard is what keeps `$.data.tags[*]` from
   * matching a `tags` that is a plain string.
   */
  private static wildcard(
    source: string,
    groups: PathSelector[][],
    depth: number,
    f: Filter
  ): { cond: string; args: any[] } {
    const alias = `je${depth}`;
    const groupPath = SqliteCompiler.sqlitePath(groups[depth]);
    const remaining = groups.length - depth - 1;

    let inner: { cond: string; args: any[] };
    if (remaining === 1) {
      const tail = groups[depth + 1];
      inner = SqliteCompiler.apply(
        tail.length === 0
          ? { value: `${alias}.value`, type: `${alias}.type`, exists: "1", args: [] }
          : SqliteCompiler.extract(`${alias}.value`, tail),
        f
      );
    } else {
      inner = SqliteCompiler.wildcard(`${alias}.value`, groups, depth + 1, f);
    }

    const cond =
      `json_type(${source}, ?) IN ('array','object') AND EXISTS (` +
      `SELECT 1 FROM json_each(${source}, ?) AS ${alias} WHERE ${inner.cond})`;
    return { cond, args: [groupPath, groupPath, ...inner.args] };
  }

  private static extract(source: string, selectors: PathSelector[]): NodeExpr {
    const p = SqliteCompiler.sqlitePath(selectors);
    return {
      value: `json_extract(${source}, ?)`,
      type: `json_type(${source}, ?)`,
      exists: `json_type(${source}, ?) IS NOT NULL`,
      args: [p],
    };
  }

  /**
   * Writes one leaf operator against a node. Every operator that reads a value
   * is guarded by `exists`: without it `json_extract` returns SQL NULL for an
   * absent field, and `NULL IS NOT 'x'` is true — which would make `neq` match
   * a missing field, the exact pre-D29 behaviour the ANY rule replaces.
   */
  private static apply(node: NodeExpr, f: Filter): { cond: string; args: any[] } {
    // `node.args` holds the path bound once per expression the operator uses,
    // so it is repeated per placeholder rather than shared.
    const value = () => ({ sql: node.value, args: [...node.args] });
    const exists = () => ({ sql: node.exists, args: node.exists === "1" ? [] : [...node.args] });
    const type = () => ({ sql: node.type, args: [...node.args] });

    switch (f.op) {
      case "exists": {
        const e = exists();
        return { cond: e.sql, args: e.args };
      }
      case "eq":
      case "neq": {
        const e = exists();
        const v = value();
        const cmp = f.op === "eq" ? "IS" : "IS NOT";
        return {
          cond: `${e.sql} AND ${v.sql} ${cmp} ?`,
          args: [...e.args, ...v.args, f.value],
        };
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const e = exists();
        const v = value();
        return {
          cond: `${e.sql} AND ${v.sql} ${SqliteCompiler.cmpOps[f.op]} ?`,
          args: [...e.args, ...v.args, f.value],
        };
      }
      case "in": {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          throw new ValidationError(`op "in" requires a non-empty array value`);
        }
        const e = exists();
        const v = value();
        const ph = Array(f.value.length).fill("?").join(",");
        return {
          cond: `${e.sql} AND ${v.sql} IN (${ph})`,
          args: [...e.args, ...v.args, ...f.value],
        };
      }
      case "contains": {
        // Substring on a string, and nothing else (D29). The type guard is
        // what holds that line: `json_extract` renders an object or array as
        // its JSON text, so without it `contains` would quietly match braces
        // and field names inside a nested object.
        const t = type();
        const v = value();
        return {
          cond: `${t.sql} = 'text' AND instr(${v.sql}, ?) > 0`,
          args: [...t.args, ...v.args, f.value],
        };
      }
      default:
        throw new ValidationError(`unknown filter op "${f.op}"`);
    }
  }

  /** Selector groups between wildcards; N wildcards yield N+1 groups. */
  private static splitOnWildcards(selectors: readonly PathSelector[]): PathSelector[][] {
    const groups: PathSelector[][] = [[]];
    for (const s of selectors) {
      if (s.kind === "wildcard") groups.push([]);
      else groups[groups.length - 1].push(s);
    }
    return groups;
  }

  /**
   * SQLite's JSON path syntax, which is close to RFC 9535 but not the same —
   * it has no `..`, and it counts from the end with `[#-1]` where RFC 9535
   * writes `[-1]`. Translating here is why the parser can accept the standard
   * spelling.
   */
  private static sqlitePath(selectors: readonly PathSelector[]): string {
    let out = "$";
    for (const s of selectors) {
      if (s.kind === "name") {
        out += "." + SqliteCompiler.quoteName(s.name);
      } else if (s.kind === "index") {
        out += s.index < 0 ? `[#${s.index}]` : `[${s.index}]`;
      }
    }
    return out;
  }

  private static quoteName(name: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
    return '"' + name.replace(/(["\\])/g, "\\$1") + '"';
  }
}
