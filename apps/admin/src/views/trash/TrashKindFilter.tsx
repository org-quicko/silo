import { ChevronDown, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { TrashKind } from '../../api/types/trash-item'
import { TrashLabels } from './trash-labels'
import styles from './Trash.module.css'

/** The Type filter: the same chip and menu as the media library's (D55), over
 *  the six kinds a receipt can stand for. `undefined` means every kind. */
export function TrashKindFilter({
  value,
  onChange,
}: {
  value: TrashKind | undefined
  onChange: (kind: TrashKind | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocument = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocument)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocument)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (kind: TrashKind | undefined) => {
    onChange(kind)
    setOpen(false)
  }

  return (
    <div ref={ref} className={styles.filterWrap}>
      <button
        type="button"
        className={`${styles.filterTrigger} ${value ? styles.filterTriggerActive : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value ? TrashLabels.kinds[value] : 'Type'}</span>
        {value ? (
          <X
            size={12}
            className={styles.filterClear}
            aria-label="Show every type"
            onClick={(event) => {
              event.stopPropagation()
              choose(undefined)
            }}
          />
        ) : (
          <ChevronDown size={13} />
        )}
      </button>
      {open && (
        <div className={styles.filterMenu} role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={`${styles.filterOption} ${!value ? styles.filterOptionActive : ''}`}
            onClick={() => choose(undefined)}
          >
            All types
          </button>
          {(Object.keys(TrashLabels.kinds) as TrashKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              role="option"
              aria-selected={value === kind}
              className={`${styles.filterOption} ${value === kind ? styles.filterOptionActive : ''}`}
              onClick={() => choose(kind)}
            >
              {TrashLabels.kinds[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
