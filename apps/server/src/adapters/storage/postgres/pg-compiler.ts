import { ValidationError } from "@silo/shared/validation-error";
import type { Filter } from "@silo/shared/filter";
import type { JsonPath } from "@silo/shared/json-path";
import type { PathSelector } from "@silo/shared/path-selector";
import { PortableData } from "../../../core/domain/portable-data";
import { QueryUtils } from "../../../core/query/query-utils";
import type { SortKey } from "../../../core/query/sort-key";
import type { PgParams } from "./pg-params";

/** An envelope field: a real column, always present, with one SQL type. */
interface PgColumn {
  column: string;
  type: "text" | "integer";
}

/**
 * The query AST as Postgres SQL, answering exactly what `SqliteCompiler` and
 * `FsFilter` answer (D29, D92). The conformance suite is what holds the three
 * together.
 *
 * A selected user field is a `jsonb` expression that is SQL NULL when the path
 * selects nothing. The rules that shape every method (docs/design/storage.md
 * §6.6):
 *
 * - Names and indexes are separate steps, `-> 'name'` and `-> 0`. The `#>`
 *   operator takes both as text and would read key `"0"` of an object for an
 *   index, or element 0 of an array for a name.
 * - Equality is `jsonb = jsonb`, which is type-strict by itself: `1` is not
 *   `"1"` or `true`, and JSON null equals only JSON null.
 * - A comparison or cast is inside a `CASE` on `jsonb_typeof`. `AND` does not
 *   fix an evaluation order in SQL, and casting a string to `numeric` is an
 *   error, not a false.
 * - Strings compare and sort `COLLATE "C"`, which is codepoint order (D92).
 * - Nothing sorts on raw `jsonb`, whose type order is not `EntryNodes.compare`'s.
 */
export class PgCompiler {
  private static readonly Comparisons: Record<string, string> = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };

  /** Read only through {@link PgCompiler.envelope}, for the reason `SqliteCompiler` gives. */
  private static readonly EnvelopeColumns: Record<string, PgColumn> = {
    id: { column: "id", type: "text" },
    rev: { column: "rev", type: "integer" },
    created_at: { column: "created_at", type: "text" },
    updated_at: { column: "updated_at", type: "text" },
  };

  static buildFilter(filter: Filter, params: PgParams): string {
    if (filter.op === "and" || filter.op === "or") {
      if (!filter.args || filter.args.length === 0) {
        throw new ValidationError(`op "${filter.op}" requires args`);
      }
      const joiner = filter.op === "or" ? " OR " : " AND ";
      return filter.args.map((arg) => `(${PgCompiler.buildFilter(arg, params)})`).join(joiner);
    }

    if (filter.op === "not") {
      if (!filter.args || filter.args.length !== 1) {
        throw new ValidationError(`op "not" takes exactly one arg`);
      }
      // Never a bare NOT, for the three-valued-logic reason `SqliteCompiler` gives.
      return `NOT COALESCE((${PgCompiler.buildFilter(filter.args[0], params)}), false)`;
    }

    return PgCompiler.leaf(QueryUtils.path(filter.path), filter, params);
  }

  /**
   * Missing and JSON null first, then numbers, strings, booleans, arrays and
   * objects (D92). One key becomes a type rank and one value per sortable
   * type; within a rank only one of the three values is ever non-null, so the
   * others tie and cost nothing. `id` breaks every tie.
   */
  static buildOrder(sort: readonly SortKey[], params: PgParams): string {
    const parts: string[] = [];

    for (const key of sort) {
      const direction = key.desc ? " DESC" : "";
      const path = QueryUtils.sortPath(key.path);
      const envelope = PgCompiler.envelope(path.root);
      if (envelope) {
        parts.push(envelope.column + direction);
        continue;
      }

      const node = PgCompiler.walk("data", path.selectors, params);
      const type = `jsonb_typeof(${node})`;
      parts.push(
        `CASE ${type} WHEN 'number' THEN 1 WHEN 'string' THEN 2 WHEN 'boolean' THEN 3 ` +
          `WHEN 'array' THEN 4 WHEN 'object' THEN 5 ELSE 0 END${direction}`,
        `CASE WHEN ${type} = 'number' THEN (${node})::numeric END${direction}`,
        `(CASE WHEN ${type} = 'string' THEN ${node} #>> '{}' END) COLLATE "C"${direction}`,
        `CASE WHEN ${type} = 'boolean' THEN (${node})::boolean END${direction}`
      );
    }

    parts.push("id");
    return parts.join(", ");
  }

  /** A leaf over a path that may select many nodes: true when any selected
   *  node satisfies it, and false over zero nodes (D29). */
  private static leaf(path: JsonPath, filter: Filter, params: PgParams): string {
    const envelope = PgCompiler.envelope(path.root);
    if (envelope) return PgCompiler.applyColumn(envelope, filter, params);

    const mark = params.mark();
    const groups = PgCompiler.splitOnWildcards(path.selectors);
    const condition =
      groups.length === 1
        ? PgCompiler.applyNode(PgCompiler.walk("data", groups[0], params), filter, params)
        : PgCompiler.wildcard("data", groups, 0, filter, params);
    if (condition === "false") params.rewind(mark);
    return condition;
  }

  /**
   * One `EXISTS` per wildcard, over the children of an array or an object.
   * The `CASE` hands each set-returning function NULL for any other type, and
   * both return no rows for NULL — so a scalar, a missing path and an empty
   * container all select nothing, which is RFC 9535's rule and the ANY rule's
   * false.
   */
  private static wildcard(
    source: string,
    groups: PathSelector[][],
    depth: number,
    filter: Filter,
    params: PgParams
  ): string {
    const alias = `w${depth}`;
    const group = PgCompiler.walk(source, groups[depth], params);
    const child = `${alias}.value`;

    let inner: string;
    if (depth + 2 === groups.length) {
      const tail = groups[depth + 1];
      inner = PgCompiler.applyNode(PgCompiler.walk(child, tail, params), filter, params);
    } else {
      inner = PgCompiler.wildcard(child, groups, depth + 1, filter, params);
    }
    if (inner === "false") return "false";

    return (
      `EXISTS (SELECT 1 FROM (` +
      `SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${group}) = 'array' THEN ${group} END) ` +
      `UNION ALL ` +
      `SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(${group}) = 'object' THEN ${group} END)` +
      `) AS ${alias} (value) WHERE ${inner})`
    );
  }

  /** A path from `source`, one operator per selector. Names are bound;
   *  indexes are integers from the parser, written in. */
  private static walk(source: string, selectors: readonly PathSelector[], params: PgParams): string {
    let node = source;
    for (const selector of selectors) {
      if (selector.kind === "name") {
        node = `(${node} -> ${params.add(selector.name)}::text)`;
      } else if (selector.kind === "index") {
        if (!Number.isSafeInteger(selector.index)) {
          throw new ValidationError(`invalid array index ${selector.index}`);
        }
        node = `(${node} -> ${selector.index})`;
      }
    }
    return node;
  }

  /** One leaf operator against a `jsonb` node. */
  private static applyNode(node: string, filter: Filter, params: PgParams): string {
    const value = filter.value;
    switch (filter.op) {
      case "exists":
        return `${node} IS NOT NULL`;
      case "eq":
        return PgCompiler.nodeEqualsAny(node, [value], params);
      case "neq":
        return `${node} IS NOT NULL AND NOT COALESCE(${PgCompiler.nodeEqualsAny(node, [value], params)}, false)`;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const operator = PgCompiler.Comparisons[filter.op];
        if (PgCompiler.isComparableNumber(value)) {
          return `CASE WHEN jsonb_typeof(${node}) = 'number' THEN (${node})::numeric ${operator} ${params.add(String(value))}::numeric ELSE false END`;
        }
        if (typeof value === "string") {
          return `CASE WHEN jsonb_typeof(${node}) = 'string' THEN (${node} #>> '{}') COLLATE "C" ${operator} ${PgCompiler.boundText(value, params)} ELSE false END`;
        }
        return "false";
      }
      case "in":
        return PgCompiler.nodeEqualsAny(node, PgCompiler.list(value), params);
      case "contains": {
        const needle = PgCompiler.needle(value);
        if (needle === null) return "false";
        return `CASE WHEN jsonb_typeof(${node}) = 'string' THEN strpos(${node} #>> '{}', ${params.add(needle)}::text) > 0 ELSE false END`;
      }
      default:
        throw new ValidationError(`unknown filter op "${filter.op}"`);
    }
  }

  /** One leaf operator against an envelope column, which always exists. */
  private static applyColumn(column: PgColumn, filter: Filter, params: PgParams): string {
    const value = filter.value;
    switch (filter.op) {
      case "exists":
        return "true";
      case "eq":
        return PgCompiler.columnEqualsAny(column, [value], params);
      case "neq":
        return `NOT COALESCE(${PgCompiler.columnEqualsAny(column, [value], params)}, false)`;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const operator = PgCompiler.Comparisons[filter.op];
        if (column.type === "integer" && PgCompiler.isComparableNumber(value)) {
          return `${column.column} ${operator} ${params.add(String(value))}::numeric`;
        }
        if (column.type === "text" && typeof value === "string") {
          return `${column.column} ${operator} ${PgCompiler.boundText(value, params)}`;
        }
        return "false";
      }
      case "in":
        return PgCompiler.columnEqualsAny(column, PgCompiler.list(value), params);
      case "contains": {
        const needle = PgCompiler.needle(value);
        if (column.type !== "text" || needle === null) return "false";
        return `strpos(${column.column}, ${params.add(needle)}::text) > 0`;
      }
      default:
        throw new ValidationError(`unknown filter op "${filter.op}"`);
    }
  }

  /**
   * True when the node equals one of `values`. Values no stored node can hold
   * are dropped first: an object or array (`QueryUtils` refuses them, but the
   * compiler does not rely on that), a number JSON cannot spell, and a string
   * `PortableData` would have refused on write.
   */
  private static nodeEqualsAny(node: string, values: readonly unknown[], params: PgParams): string {
    const scalars = values.filter(PgCompiler.isStorableScalar);
    if (scalars.length === 0) return "false";
    if (scalars.length === 1) return `${node} = ${params.json(scalars[0])}`;
    return `${node} IN (SELECT jsonb_array_elements(${params.json(scalars)}))`;
  }

  private static columnEqualsAny(
    column: PgColumn,
    values: readonly unknown[],
    params: PgParams
  ): string {
    const matching = values.filter((value) =>
      column.type === "text"
        ? typeof value === "string" && PortableData.problem(value) === null
        : typeof value === "number" && Number.isFinite(value)
    );
    if (matching.length === 0) return "false";

    const cast = column.type === "text" ? "::text" : "::numeric";
    if (matching.length === 1) {
      return `${column.column} = ${params.add(String(matching[0]))}${cast}`;
    }
    return `${column.column} = ANY(ARRAY(SELECT jsonb_array_elements_text(${params.json(matching)})${cast}))`;
  }

  private static isStorableScalar(value: unknown): boolean {
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && PortableData.problem(value) === null;
  }

  /**
   * A string to compare against, in codepoint order. One Postgres cannot hold
   * is refused rather than bound: the driver would replace a lone surrogate
   * with U+FFFD and compare against that instead.
   */
  private static boundText(value: string, params: PgParams): string {
    const problem = PortableData.problem(value);
    if (problem) throw new ValidationError(`a filter value ${problem}`);
    return `${params.add(value)}::text COLLATE "C"`;
  }

  /** NaN orders nowhere in JavaScript but above everything in `numeric`, so it matches nothing. */
  private static isComparableNumber(value: unknown): value is number {
    return typeof value === "number" && !Number.isNaN(value);
  }

  /**
   * The substring `contains` looks for, or null when nothing can hold it. A
   * number or boolean is looked for as its text, as the other adapters do.
   */
  private static needle(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return PortableData.problem(text) === null ? text : null;
  }

  private static list(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new ValidationError(`op "in" requires a non-empty array value`);
    }
    return value;
  }

  private static envelope(root: string): PgColumn | undefined {
    return Object.hasOwn(PgCompiler.EnvelopeColumns, root)
      ? PgCompiler.EnvelopeColumns[root]
      : undefined;
  }

  /** Selector groups between wildcards; N wildcards yield N+1 groups. */
  private static splitOnWildcards(selectors: readonly PathSelector[]): PathSelector[][] {
    const groups: PathSelector[][] = [[]];
    for (const selector of selectors) {
      if (selector.kind === "wildcard") groups.push([]);
      else groups[groups.length - 1].push(selector);
    }
    return groups;
  }
}
