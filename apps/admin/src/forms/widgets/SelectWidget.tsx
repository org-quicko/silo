import { Segmented } from '../../components/controls/Segmented'

/** What a `null` member of an enum is called. It is a real choice — an
 *  imported Strapi enumeration is nullable and half its rows may be empty — so
 *  it is offered, not hidden. */
const NotSet = 'Not set'

/**
 * The control for an `enum`.
 *
 * Options are addressed by **index** rather than by value, because an enum's
 * members are JSON values and only some of them survive a trip through a DOM
 * attribute: `null` becomes the string `"null"`, and a number comes back as
 * text. The index is the one thing a `<select>` can carry that means the same
 * on both sides.
 */
export function SelectWidget(props: any) {
  const { id, value, disabled, readonly, onChange, options, multiple } = props
  const enumOptions: { value: any; label: string }[] = options?.enumOptions || []
  const labelled = enumOptions.map((option) => ({
    ...option,
    label: option.value === null ? NotSet : option.label,
  }))
  const chosen = labelled.findIndex((option) => option.value === value)

  // ≤4 single-select options render as a segmented control (design: status).
  if (!multiple && labelled.length > 0 && labelled.length <= 4) {
    return (
      <Segmented
        value={String(chosen)}
        options={labelled.map((option, index) => ({ value: String(index), label: option.label }))}
        disabled={disabled || readonly}
        onChange={(index) => onChange(labelled[Number(index)]?.value)}
      />
    )
  }
  return (
    <select
      id={id}
      className="input"
      value={chosen === -1 ? '' : String(chosen)}
      disabled={disabled || readonly}
      multiple={multiple}
      onChange={(e) => onChange(e.target.value === '' ? undefined : labelled[Number(e.target.value)]?.value)}
    >
      {chosen === -1 && <option value="" />}
      {labelled.map((o, index) => (
        <option key={index} value={index}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
