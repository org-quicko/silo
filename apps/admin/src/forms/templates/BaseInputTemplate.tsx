export function BaseInputTemplate(props: any) {
  const { id, value, required, disabled, readonly, onChange, onBlur, onFocus, options, schema, type, placeholder, rawErrors } =
    props
  const hasError = rawErrors && rawErrors.length > 0
  const inputType = type || (schema?.type === 'number' || schema?.type === 'integer' ? 'number' : 'text')
  return (
    <input
      id={id}
      className={`input ${hasError ? 'error' : ''}`}
      type={inputType}
      value={value ?? ''}
      required={required}
      disabled={disabled || readonly}
      placeholder={placeholder}
      aria-invalid={hasError ? 'true' : undefined}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === '' ? options?.emptyValue ?? undefined : v)
      }}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
    />
  )
}
