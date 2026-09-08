import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ClipboardEvent, KeyboardEvent, MouseEvent, RefObject } from 'react'
import { VariableTemplate } from '@silo/shared/variable-template'
import type { VariableHint } from './variable-hints'
import { VariableDom } from './variable-dom'
import styles from './VariableAffordance.module.css'

/** Every newline, for the single-line field that may hold none. */
const NEWLINES = /\r?\n/g

/**
 * A text field where `{{NAME}}` is a **chip carrying the name and the value**
 * (D57).
 *
 * This is the third shape this control took, and the two it replaced are worth
 * recording because the constraint that killed them is the whole reason this
 * one is a `contenteditable`:
 *
 * 1. A readout beside the field is not "in the field".
 * 2. A **mirror** — a layer above a real `<input>` with transparent text —
 *    puts the chip exactly where the author typed it, and is the cheapest way
 *    to do that, because nothing about a text field has to be reimplemented.
 *    But its correctness rests on the chip occupying *exactly* the token's
 *    width, since the invisible characters underneath still advance. A chip
 *    showing `API_URL` **and** `https://api.example.com` is several times
 *    wider than `{{API_URL}}`, so every character after it would fall out of
 *    step with the text it is meant to sit over. No amount of styling gets
 *    around that: the layer beneath is a real input and its metrics are the
 *    browser's.
 *
 * So the token has to be a real element in a real flow, and that means the
 * editable surface is a `contenteditable` rather than an `<input>`. What that
 * costs is stated here rather than discovered later: `type`, `maxlength`,
 * native form validation and autofill do not apply, which is why the callers
 * only route **plain text** string fields here — a date, a number or an enum
 * keeps its native control.
 *
 * What it does **not** cost is the part that matters. Each chip is a
 * `contenteditable="false"` element, which browsers treat as one atomic
 * character: caret movement, shift-selection, double-click-to-select-a-word,
 * drag-select and Backspace-deletes-the-whole-chip are all native. The string
 * is the source of truth (`VariableDom`), the DOM is a rendering of it, and a
 * chip contributes `{{NAME}}` to that string no matter what it displays.
 *
 * The surface is **uncontrolled between renders**: React writes the DOM only
 * when the incoming value differs from what this last emitted. Re-rendering on
 * every keystroke is what makes a `contenteditable` lose the caret, and the one
 * case that genuinely needs a mid-typing re-render — finishing a reference, so
 * it becomes a chip — restores the caret by offset afterwards.
 */
export function VariableTextField({
  value,
  onChange,
  hints,
  env,
  multiline,
  editableRef,
  caretRequest,
  id,
  placeholder,
  disabled,
  invalid,
  className,
  onKeyDown,
  onKeyUp,
  onSelectionChange,
}: {
  value: string
  onChange: (next: string) => void
  hints: readonly VariableHint[]
  env: string
  multiline: boolean
  /** The editable element, so the affordance around it can read the caret. */
  editableRef: RefObject<HTMLDivElement | null>
  /** Where the caret should land after the next render this does. Shared with
   *  the affordance, because a completion accepted there and a reference
   *  finished by typing here both need it. */
  caretRequest: RefObject<number | null>
  id?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  onKeyUp?: (event: KeyboardEvent<HTMLDivElement>) => void
  onSelectionChange?: () => void
}) {
  /** What this last handed upward, so an echo of it is not written back into
   *  the DOM under the caret. */
  const emitted = useRef<string>(value)

  const render = useCallback(
    (text: string) => {
      const host = editableRef.current
      if (!host) return

      host.textContent = ''
      let cursor = 0
      for (const reference of VariableTemplate.references(text)) {
        if (reference.start > cursor) {
          host.append(document.createTextNode(text.slice(cursor, reference.start)))
        }
        const hint = hints.find((candidate) => candidate.name === reference.name)
        const chip = document.createElement('span')
        chip.setAttribute(VariableDom.Attribute, reference.name)
        chip.contentEditable = 'false'
        chip.className = `${styles.chip} ${styles[hint?.state ?? 'undeclared']}`

        const name = document.createElement('span')
        name.className = styles.chipName
        name.textContent = reference.name
        chip.append(name)

        const shown = document.createElement('span')
        shown.className = styles.chipValue
        if (hint?.state === 'resolved') {
          shown.textContent = hint.value === '' ? 'empty' : (hint.value ?? '')
          if (hint.value === '') shown.classList.add(styles.chipFaint)
        } else if (hint?.state === 'unset') {
          shown.textContent = `unset in ${env}`
        } else {
          shown.textContent = 'not declared'
        }
        chip.append(shown)

        host.append(chip)
        cursor = reference.end
      }
      if (cursor < text.length) host.append(document.createTextNode(text.slice(cursor)))
      // A trailing text node the caret can land in: without it, a caret after a
      // chip at the very end of the value has nowhere to sit and typing lands
      // inside the chip.
      host.append(document.createTextNode(''))
    },
    [editableRef, hints, env],
  )

  // Write the DOM when the value changed elsewhere — a different entry loaded,
  // a completion accepted, a reference finished — and never merely because a
  // keystroke echoed back through React.
  useLayoutEffect(() => {
    const host = editableRef.current
    if (!host) return
    if (value === emitted.current && VariableDom.read(host) === value) return

    render(value)
    emitted.current = value
    if (caretRequest.current !== null) {
      const target = caretRequest.current
      caretRequest.current = null
      VariableDom.setCaret(host, target)
    }
  }, [value, render, editableRef, caretRequest])

  // Re-chip when the *values* arrive or change: the list is fetched after the
  // form mounts, so the first render often has nothing to colour a chip by.
  useEffect(() => {
    const host = editableRef.current
    if (!host || document.activeElement === host) return
    render(value)
    // `value` is handled by the effect above; this one is about the hints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hints, render])

  const emit = () => {
    const host = editableRef.current
    if (!host) return
    // A single-line field cannot hold a newline, exactly as an `<input>`
    // cannot. Browsers put one in anyway — a `white-space: pre`
    // contenteditable gets a stray newline text node when the caret is
    // parked at the end — so it is stripped here rather than saved into an
    // entry nobody typed it in.
    const raw = VariableDom.read(host)
    const next = multiline ? raw : raw.replace(NEWLINES, '')
    if (next === emitted.current) return

    // A reference the author just finished typing has to become a chip, which
    // is a re-render, which moves the caret — so where it should end up is
    // recorded first, in the string's own coordinates.
    const before = VariableTemplate.references(emitted.current).length
    const after = VariableTemplate.references(next).length
    if (after !== before) {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        caretRequest.current = VariableDom.caretOffset(host, range.startContainer, range.startOffset)
      }
    }

    emitted.current = next
    onChange(next)
  }

  /**
   * Clicking a chip puts the caret beside it rather than nowhere.
   *
   * A `contenteditable="false"` node is not a place a caret can go, and a click
   * that lands on one leaves the field focused with no insertion point — it
   * looks editable and silently swallows every keystroke. The caret goes to
   * whichever end of the chip was nearer, which is what clicking a word in
   * ordinary text does.
   */
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const chip = (event.target as HTMLElement | null)?.closest(
      `[${VariableDom.Attribute}]`,
    ) as HTMLElement | null
    if (!chip) return

    event.preventDefault()
    const host = editableRef.current
    const selection = window.getSelection()
    if (!host || !selection) return

    const box = chip.getBoundingClientRect()
    const range = document.createRange()
    if (event.clientX < box.left + box.width / 2) range.setStartBefore(chip)
    else range.setStartAfter(chip)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    host.focus()
    onSelectionChange?.()
  }

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // Plain text only. A paste carrying markup would put arbitrary elements
    // beside the chips, and `VariableDom.read` would flatten them into
    // whatever their text happened to be.
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
  }

  return (
    <div
      id={id}
      ref={editableRef}
      role="textbox"
      aria-multiline={multiline}
      aria-invalid={invalid ? 'true' : undefined}
      aria-label={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck={multiline}
      data-placeholder={placeholder}
      className={[
        className ?? '',
        styles.editable,
        multiline ? styles.editableWrap : styles.editableLine,
        value === '' ? styles.empty : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onInput={emit}
      onBlur={emit}
      onMouseDown={onMouseDown}
      onPaste={onPaste}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        // A single-line field submits on Enter the way an `<input>` does, and
        // must never take a newline it cannot show.
        if (event.key === 'Enter' && !multiline) event.preventDefault()
      }}
      onKeyUp={(event) => {
        onKeyUp?.(event)
        onSelectionChange?.()
      }}
      onMouseUp={onSelectionChange}
    />
  )
}
