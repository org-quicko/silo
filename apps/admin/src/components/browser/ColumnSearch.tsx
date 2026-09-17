import { Search, X } from 'lucide-react'
import { useRef } from 'react'
import styles from './ScopeBrowser.module.css'

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** A filter for the items in one scope column. */
export function ColumnSearch({ label, value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const clear = () => {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={styles.columnSearch}>
      <Search size={13} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={`${label}…`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            event.stopPropagation()
            clear()
          }
        }}
      />
      {value && (
        <button
          type="button"
          className={styles.searchClear}
          aria-label={`Clear ${label.toLowerCase()}`}
          title="Clear search (Esc)"
          onClick={clear}
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
