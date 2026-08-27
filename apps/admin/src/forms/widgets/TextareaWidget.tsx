import styles from './TextareaWidget.module.css'

export function TextareaWidget(props: any) {
  const { id, value, disabled, readonly, onChange, options, rawErrors, placeholder } = props
  const hasError = rawErrors && rawErrors.length > 0
  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <span className={`${styles.tool} ${styles.bold}`}>B</span>
        <span className={`${styles.tool} ${styles.italic}`}>I</span>
        <span className={`${styles.tool} ${styles.code}`}>&lt;/&gt;</span>
        <span className={styles.separator} />
        <span className={`${styles.tool} ${styles.heading}`}>H2</span>
      </div>
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
