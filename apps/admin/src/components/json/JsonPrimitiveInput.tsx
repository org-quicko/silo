import { useEffect, useRef, useState } from 'react'
import { AlignLeft, Minus } from 'lucide-react'
import { Toggle } from '../controls/Toggle'
import styles from './JsonPrimitiveInput.module.css'

export interface JsonPrimitiveInputProps {
  value: string | number | boolean | null
  disabled?: boolean
  multilineByDefault?: boolean
  autoFocus?: boolean
  onChange: (nextValue: unknown) => void
}

/**
 * Typed inline control for JSON scalar values (`string`, `number`, `boolean`,
 * `null`), preserving `{{NAME}}` templates and exact numeric/boolean semantics.
 */
export function JsonPrimitiveInput({
  value,
  disabled = false,
  multilineByDefault = false,
  autoFocus = false,
  onChange,
}: JsonPrimitiveInputProps) {
  if (typeof value === 'boolean') {
    return (
      <div className={styles.booleanWrap}>
        <Toggle size="sm" on={value} disabled={disabled} onChange={(next) => onChange(next)} />
        <span className={styles.booleanLabel}>{value ? 'true' : 'false'}</span>
      </div>
    )
  }

  if (value === null) {
    return <span className={styles.nullValue}>null</span>
  }

  if (typeof value === 'number') {
    return <NumberInput value={value} disabled={disabled} autoFocus={autoFocus} onChange={onChange} />
  }

  return (
    <StringInput
      value={value}
      disabled={disabled}
      multilineByDefault={multilineByDefault}
      autoFocus={autoFocus}
      onChange={onChange}
    />
  )
}

function StringInput({
  value,
  disabled,
  multilineByDefault,
  autoFocus,
  onChange,
}: {
  value: string
  disabled: boolean
  multilineByDefault: boolean
  autoFocus: boolean
  onChange: (nextValue: string) => void
}) {
  const [multiline, setMultiline] = useState(() => multilineByDefault || value.includes('\n'))
  const inputRef = useRef<HTMLInputElement | null>(null)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!autoFocus || disabled) return
    if (multiline) areaRef.current?.focus()
    else inputRef.current?.focus()
  }, [autoFocus, disabled, multiline])

  return (
    <div className={styles.stringWrap}>
      {multiline ? (
        <textarea
          ref={areaRef}
          className={styles.textarea}
          rows={Math.min(8, Math.max(2, value.split('\n').length))}
          value={value}
          disabled={disabled}
          placeholder="Text value…"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={value}
          disabled={disabled}
          placeholder="Text value…"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {!disabled && (
        <button
          type="button"
          className={`${styles.modeToggle} ${multiline ? styles.modeToggleActive : ''}`}
          title={multiline ? 'Switch to single-line input' : 'Switch to multiline editor'}
          aria-label={multiline ? 'Single-line text' : 'Multiline text'}
          aria-pressed={multiline}
          onClick={() => setMultiline((previous) => !previous)}
        >
          {multiline ? <Minus size={11} /> : <AlignLeft size={11} />}
        </button>
      )}
    </div>
  )
}

function NumberInput({
  value,
  disabled,
  autoFocus,
  onChange,
}: {
  value: number
  disabled: boolean
  autoFocus: boolean
  onChange: (nextValue: number) => void
}) {
  const valueText = String(value)
  const [prevSynced, setPrevSynced] = useState(valueText)
  const [draft, setDraft] = useState(valueText)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (valueText !== prevSynced) {
    setPrevSynced(valueText)
    if (!focused) {
      setDraft(valueText)
    }
  }

  useEffect(() => {
    if (!autoFocus || disabled) return
    inputRef.current?.focus()
  }, [autoFocus, disabled])

  const trimmed = draft.trim()
  const parsed = trimmed === '' ? Number.NaN : Number(trimmed)
  const valid = Number.isFinite(parsed)

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className={`${styles.input} ${styles.numberInput} ${valid ? '' : styles.invalid}`}
      value={draft}
      disabled={disabled}
      aria-invalid={!valid}
      placeholder="0"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (!valid) {
          setDraft(valueText)
        }
      }}
      onChange={(event) => {
        const nextDraft = event.target.value
        setDraft(nextDraft)
        const nextTrimmed = nextDraft.trim()
        if (nextTrimmed !== '') {
          const nextNumber = Number(nextTrimmed)
          if (Number.isFinite(nextNumber)) {
            onChange(nextNumber)
          }
        }
      }}
    />
  )
}
