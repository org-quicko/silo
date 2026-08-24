import type { Filter } from '@silo/shared/filter'
import { FilterOps } from '@silo/shared/filter-ops'
import { JsonPath } from '@silo/shared/json-path'

/**
 * The value type a row compares with, which decides how its text is read and
 * which ops `FilterFields.ops` offers for it (handoff 1d). `enum` and
 * `date-time` are JSON Schema refinements of `string` — the wire value is
 * still a string — so `coerce` treats them like one; they exist as their own
 * type only so the builder can narrow the op list and pick a value control.
 */
export type FilterValueType = 'string' | 'number' | 'boolean' | 'enum' | 'date-time'

/**
 * One line of the filter builder. `value` stays the raw text the user typed —
 * coercion happens on the way to the AST, driven by `type`, so re-opening a
 * saved filter shows what was typed rather than a guess at it.
 */
export interface FilterRow {
  path: string
  /**
   * A `FilterOps.Leaf` op, or the synthetic `'between'` — a date-time range
   * offered as one row (handoff 1d) but compiled to two real leaves, `gte`
   * and `lte`, since the AST has no range op and does not need one.
   */
  op: string
  /** `'between'` packs `"from, to"` here, split the same way `in` splits a list. */
  value: string
  type: FilterValueType
}

/** The whole builder: a flat list of conditions joined one way. */
export interface FilterDraft {
  join: 'and' | 'or'
  rows: FilterRow[]
}

/**
 * The bridge between the filter builder and the Query AST (D29).
 *
 * The builder is deliberately *less* expressive than the AST: a flat list with
 * one join, no nesting and no `not`. That covers what a table filter is for,
 * and — this is the point — `fromFilter` returns `null` for anything outside
 * it rather than dropping the parts it cannot draw. A URL that carries a
 * hand-written or nested filter therefore keeps working: the view still sends
 * it, and shows it as read-only instead of quietly simplifying a query the
 * user did not ask to have simplified.
 */
export class FilterModel {
  static readonly Empty: FilterDraft = { join: 'and', rows: [] }

  /** A row the user has finished — an unfinished one is not an empty filter. */
  static isComplete(row: FilterRow): boolean {
    if (!row.path || !JsonPath.isValid(row.path)) return false
    if (row.op === 'between') {
      const [from, to] = FilterModel.pair(row.value)
      return from !== '' && to !== ''
    }
    if (!FilterOps.isLeaf(row.op)) return false
    const arity = FilterOps.arity(row.op)
    if (arity === 'path') return true
    if (row.value.trim() === '') return false
    if (row.type === 'number') return FilterModel.values(row).every((v) => Number.isFinite(v as number))
    return true
  }

  /** `null` when nothing is complete — an empty filter is an absent one. */
  static toFilter(draft: FilterDraft): Filter | null {
    const args = draft.rows.filter(FilterModel.isComplete).map(FilterModel.leaf)
    if (args.length === 0) return null
    // A single condition needs no wrapper: `and(x)` and `x` select the same
    // entries, and the shorter one is what round-trips back to one row.
    return args.length === 1 ? args[0] : { op: draft.join, args }
  }

  /** `null` when the AST is outside what the builder can draw. */
  static fromFilter(filter: Filter | null | undefined): FilterDraft | null {
    if (!filter) return FilterModel.Empty
    if (FilterOps.isLeaf(filter.op)) {
      const row = FilterModel.row(filter)
      return row ? { join: 'and', rows: [row] } : null
    }
    if (filter.op !== 'and' && filter.op !== 'or') return null
    if (!filter.args || filter.args.length === 0) return null

    const rows: FilterRow[] = []
    for (const arg of filter.args) {
      if (!FilterOps.isLeaf(arg.op)) return null
      const row = FilterModel.row(arg)
      if (!row) return null
      rows.push(row)
    }
    return { join: filter.op, rows }
  }

  static blankRow(path: string, type: FilterValueType = 'string'): FilterRow {
    return { path, op: 'eq', value: '', type }
  }

  private static leaf(row: FilterRow): Filter {
    if (row.op === 'between') {
      const [from, to] = FilterModel.pair(row.value)
      return {
        op: 'and',
        args: [
          { op: 'gte', path: row.path, value: FilterModel.coerce(from, row.type) },
          { op: 'lte', path: row.path, value: FilterModel.coerce(to, row.type) },
        ],
      }
    }
    if (FilterOps.arity(row.op) === 'path') return { op: row.op, path: row.path }
    const values = FilterModel.values(row)
    return {
      op: row.op,
      path: row.path,
      value: FilterOps.arity(row.op) === 'values' ? values : values[0],
    }
  }

  /** `"from, to"` → `["from", "to"]`, both trimmed; a missing half is `""`. */
  private static pair(value: string): [string, string] {
    const [from = '', to = ''] = value.split(',').map((p) => p.trim())
    return [from, to]
  }

  /**
   * `in` takes a list, every other leaf takes one value — so the text is split
   * for the first and left whole for the rest. Splitting unconditionally would
   * make a comma in a title unsearchable.
   */
  private static values(row: FilterRow): unknown[] {
    const parts =
      FilterOps.arity(row.op) === 'values'
        ? row.value.split(',').map((p) => p.trim()).filter((p) => p !== '')
        : [row.value]
    return parts.map((p) => FilterModel.coerce(p, row.type))
  }

  private static coerce(text: string, type: FilterValueType): unknown {
    if (type === 'number') return Number(text)
    if (type === 'boolean') return text.trim().toLowerCase() === 'true'
    return text
  }

  private static row(leaf: Filter): FilterRow | null {
    if (!leaf.path || !JsonPath.isValid(leaf.path)) return null
    const arity = FilterOps.arity(leaf.op)
    if (arity === 'path') {
      return { path: leaf.path, op: leaf.op, value: '', type: 'string' }
    }
    const raw = arity === 'values' ? leaf.value : [leaf.value]
    if (arity === 'values' && !Array.isArray(raw)) return null
    const list = raw as unknown[]
    // A mixed-type list has no single input to show, and `null` has no text at
    // all — both are legal AST and neither is a row, so the caller is told.
    const types = new Set(list.map((v) => typeof v))
    if (types.size !== 1) return null
    const t = [...types][0]
    if (t !== 'string' && t !== 'number' && t !== 'boolean') return null
    return { path: leaf.path, op: leaf.op, value: list.join(', '), type: t }
  }
}
