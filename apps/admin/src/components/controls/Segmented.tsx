import type { ReactNode } from 'react'
import styles from './Segmented.module.css'

const variantClass = {
  default: '',
  compact: 'compact',
  fit: 'fit',
  tabs: 'tabs',
} as const

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
  /** `compact` shrinks the whole control for an inline filter bar. `fit`
   *  keeps full size but sizes each option to its own label instead of
   *  stretching every option equally — for a control holding one option much
   *  longer than the rest. `tabs` is a page's own tab strip: full size, each
   *  option a fixed width rather than stretched to fill the row, with the
   *  selected tab lifting off the row instead of filling with the accent
   *  color. */
  variant?: 'default' | 'compact' | 'fit' | 'tabs'
  disabled?: boolean
}) {
  const modifier = styles[variantClass[variant]]
  return (
    <div className={`${styles.root} ${modifier || ''}`} role="tablist">
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
