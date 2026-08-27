import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Segmented } from '../../components/controls/Segmented'
import { FilterModel, type FilterDraft, type FilterRow, type FilterValueType } from '../../query/filter-model'
import { FilterFields, type FilterField } from './filter-fields'
import styles from './FilterBuilder.module.css'

/** A one-glyph hint for a field's type, drawn beside its name in the picker. */
const TYPE_GLYPH: Record<FilterValueType, string> = {
  string: 'S',
  number: '#',
  boolean: '✓',
  enum: 'E',
  'date-time': 'D',
}

/**
 * The filter builder (D29/P3): a flat list of conditions over the path AST.
 *
 * It offers exactly the ops `FilterFields.ops` narrows to for each field's
 * JSON Schema type, and exactly the paths `JsonPath` can build, so nothing it
 * produces can be a `400` the reader has no way to fix. What it cannot draw —
 * nesting, `not` — it says so about and leaves alone; see `FilterModel`.
 */
export function FilterBuilder({
  schema,
  draft,
  advanced,
  focusRow,
  onApply,
  onClose,
}: {
  schema: any
  draft: FilterDraft
  /** The raw filter when the URL holds one the builder cannot draw. */
  advanced: string | null
  /** Set when opened from a `FilterChips` click, to mark which row it named. */
  focusRow?: number
  onApply: (draft: FilterDraft) => void
  onClose: () => void
}) {
  const fields = FilterFields.of(schema)
  const [rows, setRows] = useState<FilterRow[]>(
    // The type an AST leaf round-trips with is inferred from the value's
    // runtime type (`FilterModel.row`), which cannot tell an enum or a
    // date-time apart from an ordinary string — only the schema can. Rows are
    // reconciled against it once here, so the op list and value control match
    // the field the moment the panel opens, not only after it is re-picked.
    (draft.rows.length > 0 ? draft.rows : [FilterBuilder.blank(fields)]).map((r) => FilterBuilder.reconcile(r, fields)),
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

  // Changing the field re-reads the value type from the schema and resets the
  // op to the new type's first choice: a value left over from a string field
  // would otherwise be sent as a string to a number field and match nothing,
  // and an op like `contains` simply is not offered for a number at all.
  const pickField = (i: number, path: string) => {
    const field = fields.find((f) => f.path === path)
    const type = field ? field.type : 'string'
    const op = field ? FilterFields.ops(field)[0].op : 'eq'
    patch(i, { path, type, op, value: '' })
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
      <div className={styles.matchHead}>
        <span>Match</span>
        <Segmented
          variant="compact"
          value={join}
          onChange={setJoin}
          options={[
            { value: 'and', label: 'all' },
            { value: 'or', label: 'any' },
          ]}
        />
        <span>of these</span>
      </div>

      {rows.map((row, i) => {
        const field = fields.find((f) => f.path === row.path)
        const ops = field ? FilterFields.ops(field) : FilterFields.ops({ type: 'string' })
        return (
          <div key={i} className={`${styles.rowGroup} ${i === focusRow ? styles.rowFocused : ''}`}>
            <div className={styles.row}>
              <span className={styles.joinCell}>
                <span className={styles.joinLead}>{i === 0 ? 'Where' : join}</span>
              </span>

              <span className={styles.fieldCell}>
                <span className={styles.typeGlyph} title={row.type}>
                  {TYPE_GLYPH[row.type]}
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
              </span>

              <select
                className={styles.op}
                value={row.op}
                onChange={(e) => patch(i, { op: e.target.value, value: '' })}
                aria-label="Operator"
              >
                {ops.some((o) => o.op === row.op) ? null : <option value={row.op}>{row.op}</option>}
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>

              <ValueInput row={row} field={field} onChange={(value) => patch(i, { value })} />

              <button
                className={styles.remove}
                onClick={() => setRows(rows.length === 1 ? [FilterBuilder.blank(fields)] : rows.filter((_, at) => at !== i))}
                title="Remove condition"
                aria-label="Remove condition"
              >
                <X size={13} />
              </button>
            </div>
            <div className={styles.pathHint}>
              {row.path}
              {field?.isArray && ' · membership, not the whole array'}
            </div>
          </div>
        )
      })}

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
  const op = first ? FilterFields.ops(first)[0].op : 'eq'
  return { path: first ? first.path : '', op, value: '', type: first ? first.type : 'string' }
}

/** Re-derives a row's `type` (and, if it no longer offers `op`, its `op`) from the schema. */
FilterBuilder.reconcile = (row: FilterRow, fields: FilterField[]): FilterRow => {
  const field = fields.find((f) => f.path === row.path)
  if (!field || field.type === row.type) return row
  const ops = FilterFields.ops(field)
  const op = ops.some((o) => o.op === row.op) ? row.op : ops[0].op
  return { ...row, type: field.type, op }
}

function ValueInput({
  row,
  field,
  onChange,
}: {
  row: FilterRow
  field: FilterField | undefined
  onChange: (value: string) => void
}) {
  if (row.op === 'exists') {
    return <span className={styles.noValue}>—</span>
  }

  if (row.op === 'between') {
    const [from, to] = row.value.split(',').map((p) => p.trim())
    return (
      <span className={styles.rangeValue}>
        <input
          className={styles.value}
          type="date"
          value={from || ''}
          onChange={(e) => onChange(`${e.target.value}, ${to || ''}`)}
          aria-label="From"
        />
        <input
          className={styles.value}
          type="date"
          value={to || ''}
          onChange={(e) => onChange(`${from || ''}, ${e.target.value}`)}
          aria-label="To"
        />
      </span>
    )
  }

  if (row.type === 'date-time') {
    return <input className={styles.value} type="date" value={row.value} onChange={(e) => onChange(e.target.value)} aria-label="Value" />
  }

  if (row.type === 'boolean') {
    return (
      <select className={styles.value} value={row.value || 'true'} onChange={(e) => onChange(e.target.value)} aria-label="Value">
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }

  if (row.type === 'enum' && field?.values) {
    if (row.op === 'in') {
      const selected = new Set(row.value.split(',').map((p) => p.trim()).filter(Boolean))
      return (
        <select
          className={`${styles.value} ${styles.multiValue}`}
          multiple
          value={[...selected]}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value).join(', '))}
          aria-label="Values"
        >
          {field.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )
    }
    return (
      <select className={styles.value} value={row.value} onChange={(e) => onChange(e.target.value)} aria-label="Value">
        <option value="" disabled>
          choose…
        </option>
        {field.values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }

  const arity = row.op === 'in' ? 'values' : 'value'
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
