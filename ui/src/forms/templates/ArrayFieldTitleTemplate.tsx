// Slate array title: same compact label style used by FieldTemplate.
export function ArrayFieldTitleTemplate(props: any) {
  const { title, required } = props
  if (!title) return null
  return (
    <div className="field-label-row">
      <span className="field-label">{title}</span>
      {required && <span className="field-hint">required</span>}
    </div>
  )
}
