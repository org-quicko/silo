import { Segmented } from '../../components/Segmented'

export function SelectWidget(props: any) {
  const { id, value, disabled, readonly, onChange, options, multiple } = props
  const enumOptions: { value: any; label: string }[] = options?.enumOptions || []
  // ≤4 single-select options render as a segmented control (design: status).
  if (!multiple && enumOptions.length > 0 && enumOptions.length <= 4) {
    return (
      <Segmented
        value={value}
        options={enumOptions}
        disabled={disabled || readonly}
        onChange={onChange}
      />
    )
  }
  return (
    <select
      id={id}
      className="input"
      value={value ?? ''}
      disabled={disabled || readonly}
      multiple={multiple}
      onChange={(e) => onChange(e.target.value)}
    >
      {!value && <option value="" />}
      {enumOptions.map((o) => (
        <option key={String(o.value)} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
