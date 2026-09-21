import { useRef } from 'react'
import { getInputProps } from '@rjsf/utils'
import { SchemaType } from '../../schema/schema-type'
import { VariableAffordance } from '../variables/VariableAffordance'
import { variableContextOf } from '../variables/variable-form-context'

export function BaseInputTemplate(props: any) {
  const { id, value, required, disabled, readonly, onChange, onBlur, onFocus, options, schema, type, placeholder, rawErrors } =
    props
  const hasError = rawErrors && rawErrors.length > 0
  /*
   * RJSF reads the schema's own constraints into input attributes: the widget's
   * type (a `format` picks `date`, `email`, `url`), and `minimum`/`maximum`/
   * `multipleOf` as `min`/`max`/`step`. Deriving only the type by hand, as this
   * did, meant a field declaring a range accepted anything and said so only
   * after the save came back.
   */
  const inputProps = getInputProps(schema, type, options)
  const inputType = inputProps.type
  const inputRef = useRef<HTMLInputElement | null>(null)

  /*
   * Variables replace the control rather than decorating it (D57), so the swap
   * is held to plain text: a `{{NAME}}` chip has to be a real element, which
   * means a `contenteditable`, which means no `type`, no native validation and
   * no autofill. A date, a colour, a number or anything else with a real input
   * behind it keeps that input — `{{PORT}}` is not a number, so those fields
   * could never carry a reference anyway.
   */
  const variables = variableContextOf(props)
  const wrapped =
    variables !== null &&
    SchemaType.of(schema) === 'string' &&
    inputType === 'text' &&
    !schema?.format

  if (wrapped) {
    return (
      <VariableAffordance
        id={id}
        context={variables!}
        value={value}
        onChange={(next) => onChange(next === '' ? options?.emptyValue ?? undefined : next)}
        placeholder={placeholder}
        disabled={disabled || readonly}
        invalid={hasError}
        className={`input ${hasError ? 'error' : ''}`}
      />
    )
  }

  return (
    <input
      {...inputProps}
      id={id}
      ref={inputRef}
      className={`input ${hasError ? 'error' : ''}`}
      value={value ?? ''}
      required={required}
      disabled={disabled || readonly}
      placeholder={placeholder}
      /* `pattern` is deliberately not forwarded: the HTML attribute anchors the
         expression and JSON Schema's does not, so `[a-z]` would refuse a value
         Ajv accepts — and a native bubble refusing a submit is not an error the
         form can explain. Lengths mean the same thing in both. */
      minLength={schema?.minLength}
      maxLength={schema?.maxLength}
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
