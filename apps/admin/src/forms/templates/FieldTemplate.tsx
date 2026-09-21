import { AlertCircle } from 'lucide-react'
import { FieldHint } from '../field-hint'
import styles from './FieldTemplate.module.css'

export function FieldTemplate(props: any) {
  const { id, children, rawErrors, schema, label, displayLabel, required, description } = props
  // Root object: stack its children, no wrapper label.
  if (id === 'root' && schema?.type === 'object') {
    return <div className={styles.root}>{children}</div>
  }
  const showLabel = displayLabel && label
  const hint = FieldHint.of(schema, required)
  const isRawObject = schema?.type === 'object' || schema?.oneOf || schema?.anyOf
  return (
    <div className="field">
      {showLabel && (
        <div className="field-label-row">
          <label className="field-label" htmlFor={id}>
            {label}
          </label>
          {hint && <span className={`field-hint ${isRawObject && (schema?.oneOf || schema?.anyOf) ? 'warn' : ''}`}>{hint}</span>}
        </div>
      )}
      {children}
      {description}
      {rawErrors && rawErrors.length > 0 && (
        <div className="field-error">
          <AlertCircle size={13} />
          <span>{rawErrors[0]}</span>
        </div>
      )}
    </div>
  )
}
