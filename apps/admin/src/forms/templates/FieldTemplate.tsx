import { AlertCircle } from 'lucide-react'
import styles from './FieldTemplate.module.css'

// constraintHint mirrors the mono "string · required" hints in the design.
function constraintHint(schema: any, required: boolean): string {
  if (!schema) return ''
  const parts: string[] = []
  const t = Array.isArray(schema.type) ? schema.type.join('|') : schema.type
  if (schema.enum) parts.push('enum')
  else if (t === 'array') {
    const items = schema.items
    const it = items?.type
    if (typeof items?.$ref === 'string' || items?.['x-silo-unresolved-ref']) parts.push('array<reference>')
    else if (it) parts.push(`array<${it}>`)
    else parts.push('array')
  } else if (t) parts.push(t)
  if (schema.format) parts.push(`format ${schema.format}`)
  if (schema.pattern) parts.push(`pattern ${schema.pattern}`)
  if (typeof schema.minLength === 'number') parts.push(`min ${schema.minLength}`)
  if (required) parts.push('required')
  return parts.join(' · ')
}

export function FieldTemplate(props: any) {
  const { id, children, rawErrors, schema, label, displayLabel, required, description } = props
  // Root object: stack its children, no wrapper label.
  if (id === 'root' && schema?.type === 'object') {
    return <div className={styles.root}>{children}</div>
  }
  const showLabel = displayLabel && label
  const hint = constraintHint(schema, required)
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
