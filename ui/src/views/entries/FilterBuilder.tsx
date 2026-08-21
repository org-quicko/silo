import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { FilterOps } from '@silo/shared/filter-ops'
import { Button } from '../../components/Button'
import { FilterModel, type FilterDraft, type FilterRow } from '../../query/filter-model'
import { FilterFields, type FilterField } from './filter-fields'
import styles from './FilterBuilder.module.css'

/**
 * The filter builder (D29/P3): a flat list of conditions over the path AST.
 *
 * It offers exactly the ops `@silo/shared` declares and exactly the paths
 * `JsonPath` can build, so nothing it produces can be a `400` the reader has
 * no way to fix. What it cannot draw — nesting, `not` — it says so about and
 * leaves alone; see `FilterModel`.
 */
export function FilterBuilder({
  schema,
  draft,
  advanced,
  onApply,
  onClose,
}: {
  schema: any
  draft: FilterDraft
  /** The raw filter when the URL holds one the builder cannot draw. */
  advanced: string | null
  onApply: (draft: FilterDraft) => void
  onClose: () => void
}) {
  const fields = FilterFields.of(schema)
  const [rows, setRows] = useState<FilterRow[]>(
    draft.rows.length > 0 ? draft.rows : [FilterBuilder.blank(fields)],
  )
  const [join, setJoin] = useState<'and' | 'or'>(draft.join)
  const panel = useRef<HTMLDivElement>(null)

  // Click-away and Esc, so the panel behaves like every other popover here.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const patch = (i: number, next: Partial<FilterRow>) =>
    setRows(rows.map((r, at) => (at === i ? { ...r, ...next } : r)))

  // Changing the field re-reads the value type from the schema: a text value
  // left over from a string field would otherwise be sent as a string to a
  // number field and match nothing, with no error to explain it.
  const pickField = (i: number, path: string) => {
    const field = fields.find((f) => f.path === path)
    patch(i, { path, type: field ? field.type : 'string' })
  }

  if (advanced) {
    return (
      <div className={styles.panel} ref={panel}>
        <div className={styles.advancedHead}>This filter was not built here</div>
        <p className={styles.advancedCopy}>
          It nests, negates, or was written by hand, so the builder will not redraw it — editing it here would
          quietly simplify a query you did not ask to have simplified. It is still applied.
        </p>
        <pre className={styles.advancedJson}>{advanced}</pre>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="danger" size="sm" onClick={() => onApply(FilterModel.Empty)}>
            Clear filter
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel} ref={panel}>
      {rows.map((row, i) => (
        <div key={i} className={styles.row}>
          <span className={styles.joinCell}>
            {i === 0 ? (
              <span className={styles.joinLead}>Where</span>
            ) : i === 1 ? (
              <select
                className={styles.join}
                value={join}
                onChange={(e) => setJoin(e.target.value as 'and' | 'or')}
                aria-label="Join conditions with"
              >
                <option value="and">and</option>
                <option value="or">or</option>
              </select>
            ) : (
              <span className={styles.joinLead}>{join}</span>
            )}
          </span>

          <select
            className={styles.field}
            value={row.path}
            onChange={(e) => pickField(i, e.target.value)}
            aria-label="Field"
          >
            {fields.some((f) => f.path === row.path) ? null : (
              <option value={row.path}>{row.path}</option>
            )}
            {fields.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            className={styles.op}
            value={row.op}
            onChange={(e) => patch(i, { op: e.target.value })}
            aria-label="Operator"
          >
            {FilterOps.Leaf.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>

          <ValueInput row={row} onChange={(value) => patch(i, { value })} />

          <button
            className={styles.remove}
            onClick={() => setRows(rows.length === 1 ? [FilterBuilder.blank(fields)] : rows.filter((_, at) => at !== i))}
            title="Remove condition"
            aria-label="Remove condition"
          >
            <X size={13} />
          </button>
        </div>
      ))}

      <button className={styles.add} onClick={() => setRows([...rows, FilterBuilder.blank(fields)])}>
        <Plus size={13} /> Add condition
      </button>

      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={() => onApply(FilterModel.Empty)}>
          Clear
        </Button>
        <Button variant="primary" size="sm" onClick={() => onApply({ join, rows })}>
          Apply
        </Button>
      </div>
    </div>
  )
}

FilterBuilder.blank = (fields: FilterField[]): FilterRow => {
  const first = fields[0]
  return FilterModel.blankRow(first ? first.path : '', first ? first.type : 'string')
}

function ValueInput({ row, onChange }: { row: FilterRow; onChange: (value: string) => void }) {
  const arity = FilterOps.arity(row.op)
  if (arity === 'path') {
    return <span className={styles.noValue}>—</span>
  }
  if (row.type === 'boolean') {
    return (
      <select className={styles.value} value={row.value || 'true'} onChange={(e) => onChange(e.target.value)} aria-label="Value">
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  return (
    <input
      className={styles.value}
      // `in` takes a list, so its input is text even for numbers — the model
      // splits on commas and coerces each part.
      type={row.type === 'number' && arity !== 'values' ? 'number' : 'text'}
      value={row.value}
      placeholder={arity === 'values' ? 'a, b, c' : 'value'}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Value"
    />
  )
}
