import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import styles from './MediaLibrary.module.css'

interface Props {
  /** Every extension actually in the library — nothing renders while this is
   *  empty, since a menu with only "All types" in it is not a filter. */
  extensions: string[]
  /** `''` means "All types". */
  value: string
  onChange: (ext: string) => void
}

/** The Type filter: a menu of the extensions really in the library, not a
 *  fixed guess at what one might hold (D55). */
export function MediaTypeFilter({ extensions, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (extensions.length === 0) return null

  return (
    <div ref={ref} className={styles.filterWrap}>
      <button
        type="button"
        className={`${styles.filterTrigger} ${value ? styles.filterTriggerActive : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value ? `.${value}` : 'Type'}</span>
        {value ? (
          <X
            size={12}
            className={styles.filterClear}
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
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
            className={`${styles.filterOption} ${value === '' ? styles.filterOptionActive : ''}`}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            All types
          </button>
          {extensions.map((extension) => (
            <button
              key={extension}
              type="button"
              className={`${styles.filterOption} ${value === extension ? styles.filterOptionActive : ''}`}
              onClick={() => {
                onChange(extension)
                setOpen(false)
              }}
            >
              .{extension}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
