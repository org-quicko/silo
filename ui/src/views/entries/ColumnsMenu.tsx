import { useEffect, useRef } from 'react'
import { Columns } from './columns'
import styles from './ColumnsMenu.module.css'

/**
 * The extra-columns picker (handoff 1b "Columns 5/9"). Reordering is not
 * implemented yet — this covers what makes the table usable at all: turning
 * a field on or off without it silently falling out of the default five the
 * moment a sixth scalar is added to the schema.
 */
export function ColumnsMenu({
  fields,
  selected,
  onChange,
  onClose,
}: {
  fields: readonly string[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)

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

  // The same ceiling `Columns.parse` enforces when reading the URL back. Held
  // here too, or the picker would accept a seventh column and silently drop it
  // on the next load.
  const full = selected.length >= Columns.MaxSelected

  const toggle = (name: string) => {
    const has = selected.includes(name)
    if (has && selected.length === 1) return // at least one extra column stays visible
    if (!has && full) return
    onChange(has ? selected.filter((n) => n !== name) : [...selected, name])
  }

  return (
    <div className={styles.panel} ref={panel}>
      <div className={styles.head}>
        Columns
        <span className={styles.count}>
          {selected.length}/{Columns.MaxSelected}
        </span>
      </div>
      <div className={styles.list}>
        {fields.map((name) => {
          const on = selected.includes(name)
          return (
            <label key={name} className={`${styles.row} ${!on && full ? styles.rowDisabled : ''}`}>
              <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(name)} />
              <span>{name}</span>
            </label>
          )
        })}
        {fields.length === 0 && <span className={styles.empty}>No other fields on this schema.</span>}
      </div>
      {full && <div className={styles.note}>Turn one off to add another.</div>}
    </div>
  )
}
