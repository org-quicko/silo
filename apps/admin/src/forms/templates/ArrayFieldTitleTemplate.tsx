import styles from './ArrayFieldTitleTemplate.module.css'

// Slate array title: the same compact label style FieldTemplate uses, with the
// list's length in the hint slot. A scalar field states its type there
// ("string · required"), so without a count an array's label was the one label
// on the form that said nothing about what it holds.
export function ArrayFieldTitleTemplate(props: any) {
  const { title, required, count } = props
  if (!title) return null
  const hint = [
    typeof count === 'number' ? `${count} item${count === 1 ? '' : 's'}` : '',
    required ? 'required' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="field-label-row">
      <span className="field-label">{title}</span>
      {hint && <span className={`field-hint ${styles.count}`}>{hint}</span>}
    </div>
  )
}
