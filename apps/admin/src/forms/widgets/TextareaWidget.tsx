import { VariableAffordance } from '../variables/VariableAffordance'
import { variableContextOf } from '../variables/variable-form-context'
import styles from './TextareaWidget.module.css'

export function TextareaWidget(props: any) {
  const { id, value, disabled, readonly, onChange, options, rawErrors, placeholder } = props
  const hasError = rawErrors && rawErrors.length > 0

  // Long-form text is where a `{{NAME}}` is most likely to sit inside a
  // sentence rather than be the whole value, so it gets the same treatment the
  // single-line field does (D57) — the editable surface keeps `.area`, so the
  // editor's box, padding and line-height are unchanged.
  const variables = variableContextOf(props)

  const toolbar = (
    <div className={styles.toolbar}>
      <span className={`${styles.tool} ${styles.bold}`}>B</span>
      <span className={`${styles.tool} ${styles.italic}`}>I</span>
      <span className={`${styles.tool} ${styles.code}`}>&lt;/&gt;</span>
      <span className={styles.separator} />
      <span className={`${styles.tool} ${styles.heading}`}>H2</span>
    </div>
  )

  if (variables) {
    return (
      <div className={styles.editor}>
        {toolbar}
        <VariableAffordance
          id={id}
          context={variables}
          value={value}
          onChange={(next) => onChange(next === '' ? options?.emptyValue : next)}
          multiline
          placeholder={placeholder || 'Write more…'}
          disabled={disabled || readonly}
          invalid={hasError}
          className={`${styles.area} ${hasError ? styles.invalid : ''}`}
        />
      </div>
    )
  }

  return (
    <div className={styles.editor}>
      {toolbar}
      <textarea
        id={id}
        className={`${styles.area} ${hasError ? styles.invalid : ''}`}
        value={value ?? ''}
        disabled={disabled || readonly}
        placeholder={placeholder || 'Write more…'}
        rows={options?.rows || 4}
        onChange={(e) => onChange(e.target.value === '' ? options?.emptyValue : e.target.value)}
      />
    </div>
  )
}
