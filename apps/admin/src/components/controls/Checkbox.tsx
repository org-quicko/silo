import type { InputHTMLAttributes } from 'react'
import styles from './Checkbox.module.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  checked: boolean
  /** Some but not all of what this checkbox stands for is selected — a
   *  header "select page" control, never a single row. */
  indeterminate?: boolean
  onChange: (checked: boolean) => void
}

/** A plain selection checkbox — row and header selection, not a form field
 *  (`forms/widgets/CheckboxWidget.tsx` renders a `Toggle` for that). */
export function Checkbox({ checked, indeterminate = false, onChange, className, ...props }: Props) {
  return (
    <input
      type="checkbox"
      className={[styles.checkbox, className || ''].filter(Boolean).join(' ')}
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = indeterminate
      }}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
      {...props}
    />
  )
}
