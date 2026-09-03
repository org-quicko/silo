import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { MediaModifiedPresets, type ModifiedRange } from './media-modified-presets'
import styles from './MediaLibrary.module.css'

interface Props {
  value: ModifiedRange | null
  onChange: (range: ModifiedRange | null) => void
}

/** The Modified filter: fixed date-range presets, or a custom range typed in
 *  behind its own panel — both reduced to the same `{after, before}` bound
 *  before they ever reach `onChange` (D55). */
export function MediaModifiedFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCustom(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const apply = (range: ModifiedRange | null) => {
    onChange(range)
    setOpen(false)
    setCustom(false)
  }

  return (
    <div ref={ref} className={styles.filterWrap}>
      <button
        type="button"
        className={`${styles.filterTrigger} ${value ? styles.filterTriggerActive : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value ? value.label : 'Modified'}</span>
        {value ? (
          <X
            size={12}
            className={styles.filterClear}
            onClick={(e) => {
              e.stopPropagation()
              apply(null)
            }}
          />
        ) : (
          <ChevronDown size={13} />
        )}
      </button>
      {open && !custom && (
        <div className={styles.filterMenu} role="listbox">
          {MediaModifiedPresets.Options.map((option) => (
            <button key={option.key} type="button" className={styles.filterOption} onClick={() => apply(MediaModifiedPresets.range(option.key))}>
              {option.label}
            </button>
          ))}
          <button type="button" className={styles.filterOption} onClick={() => setCustom(true)}>
            <span>Custom date range</span>
            <ChevronRight size={13} />
          </button>
        </div>
      )}
      {open && custom && (
        <div className={`${styles.filterMenu} ${styles.filterCustom}`}>
          <label className={styles.filterDateField}>
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={styles.filterDateField}>
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className={styles.filterCustomActions}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setCustom(false)}>
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!from || !to}
              onClick={() => apply(MediaModifiedPresets.custom(from, to))}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
