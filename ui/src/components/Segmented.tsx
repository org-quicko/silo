import type { ReactNode } from 'react'
import styles from './Segmented.module.css'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  variant = 'default',
  disabled = false,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  variant?: 'default' | 'compact'
  disabled?: boolean
}) {
  return (
    <div className={`${styles.root} ${variant === 'compact' ? styles.compact : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={styles.option}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
