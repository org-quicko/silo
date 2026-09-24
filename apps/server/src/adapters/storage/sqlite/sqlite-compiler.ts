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

  /** A sort key's JSON type as its rank in `EntryNodes.compare`'s order. */
  private static readonly TypeRank =
    "CASE json_type(data, ?) WHEN 'integer' THEN 1 WHEN 'real' THEN 1 WHEN 'text' THEN 2 " +
    "WHEN 'true' THEN 3 WHEN 'false' THEN 3 WHEN 'array' THEN 4 WHEN 'object' THEN 5 ELSE 0 END";

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
        const response = SqliteCompiler.buildFilter(arg);
        parts.push("(" + response.cond + ")");
        args.push(...response.args);
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

  /**
   * Missing and JSON null first, then numbers, strings, booleans, arrays and
   * objects, which is `EntryNodes.compare` (D92). Ranking by JSON type first is
   * what stops SQLite ordering a boolean among the numbers and an object among
   * the strings; arrays and objects then tie, so the next key decides.
   */
  static buildOrder(sort: SortKey[]): { order: string; args: any[] } {
    const parts: string[] = [];
    const args: any[] = [];

    for (const k of sort) {
      const direction = k.desc ? " DESC" : "";
      const path = QueryUtils.sortPath(k.path);
      const envelope = SqliteCompiler.envelope(path.root);
      if (envelope) {
        parts.push(envelope.column + direction);
        continue;
      }
      const sqlitePath = SqliteCompiler.sqlitePath(path.selectors);
      parts.push(SqliteCompiler.TypeRank + direction);
      parts.push(
        "CASE WHEN json_type(data, ?) IN ('array','object') THEN NULL " +
          "ELSE json_extract(data, ?) END" +
          direction
      );
      args.push(sqlitePath, sqlitePath, sqlitePath);
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
        return SqliteCompiler.equalsAny(node, [f.value]);
      case "neq": {
        // Present and not equal. `COALESCE` because a bare `NOT` over SQL NULL
        // is NULL, never true.
        const e = exists();
        const match = SqliteCompiler.equalsAny(node, [f.value]);
        return {
          cond: `${e.sql} AND NOT COALESCE((${match.cond}), 0)`,
          args: [...e.args, ...match.args],
        };
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        // A number compares with numbers and a string with strings, and any
        // other pairing matches nothing (D92). Without the type guard SQLite
        // would order every number below every string and a boolean as 0 or 1.
        const guard = SqliteCompiler.orderedType(f.value);
        if (guard === null) return { cond: "0", args: [] };
        const t = type();
        const v = value();
        return {
          cond: `${t.sql} IN (${guard}) AND ${v.sql} ${SqliteCompiler.cmpOps[f.op]} ?`,
          args: [...t.args, ...v.args, f.value],
        };
      }
      case "in": {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          throw new ValidationError(`op "in" requires a non-empty array value`);
        }
        return SqliteCompiler.equalsAny(node, f.value);
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

  /**
   * True when the node strictly equals one of `values`: the same JSON type and
   * the same value (D92). JSON null, `true` and `false` are type tests alone,
   * because SQLite binds a boolean as 0 or 1 and would match it against numbers.
   */
  private static equalsAny(node: NodeExpr, values: any[]): { cond: string; args: any[] } {
    const parts: string[] = [];
    const args: any[] = [];
    const compare = (types: string, group: any[]) => {
      if (group.length === 0) return;
      const placeholders = group.map(() => "?").join(",");
      parts.push(`(${node.type} IN (${types}) AND ${node.value} IN (${placeholders}))`);
      args.push(...node.args, ...node.args, ...group);
    };
    compare("'text'", values.filter((value) => typeof value === "string"));
    compare("'integer','real'", values.filter((value) => typeof value === "number"));

    const literals = values.filter((value) => value === null || typeof value === "boolean");
    for (const literal of new Set(literals.map(String))) {
      parts.push(`${node.type} = '${literal}'`);
      args.push(...node.args);
    }
    return { cond: parts.length > 0 ? parts.join(" OR ") : "0", args };
  }

  /** The JSON types a range comparison against `value` can match, or null when
   *  none can: only numbers against numbers and strings against strings. */
  private static orderedType(value: any): string | null {
    if (typeof value === "number") return "'integer','real'";
    if (typeof value === "string") return "'text'";
    return null;
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
