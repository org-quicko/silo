import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent, MouseEvent } from 'react'
import { ExternalLink, Settings2 } from 'lucide-react'
import { VariableTemplate } from '@silo/shared/variable-template'
import type { Variable } from '../../api/types/variable'
import { Link } from '../../router/Link'
import { VariableDom } from './variable-dom'
import { VariableHints, type VariableDraft, type VariableHint } from './variable-hints'
import { VariableTextField } from './VariableTextField'
import type { VariableFormContext } from './variable-form-context'
import styles from './VariableAffordance.module.css'

/** The presses the open menu owns. Handled on keydown, and deliberately not
 *  re-read on the keyup that follows. */
const MenuKeys = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'])

/** Identity of a draft, for "is this still the same reference being typed?".
 *  `null` is its own value, so a closed menu compares equal to itself. */
function draftKey(draft: VariableDraft | null): string | null {
  return draft === null ? null : `${draft.start}:${draft.prefix}`
}

/**
 * A text field that knows about variables (D57).
 *
 * Three things, all of them **inside the field**:
 *
 * - **`{{NAME}}` is a chip carrying the name and the value.**
 *   `VariableTextField` owns that, and its doc comment records why the control
 *   has to be a `contenteditable` for a chip wider than its token to be
 *   possible at all.
 * - **Hovering a chip opens a small popover**: the value in full, what the API
 *   does with a reference it cannot resolve, and the one link to the page where
 *   a value is changed.
 * - **Typing `{{` opens a completion list** of declared names with their
 *   values. Opened by what the author already typed, never by a keystroke of
 *   its own.
 *
 * The value is shown and **never editable here**. It belongs to the environment
 * and to every other entry referencing it, so an input in this field would
 * offer an edit whose reach is nothing like the field it sits in; the link is
 * the honest affordance, and it is a `Link` so ⌘/ctrl or a middle click opens
 * it without costing a half-written entry.
 */
export function VariableAffordance({
  context,
  value,
  onChange,
  multiline = false,
  id,
  placeholder,
  disabled,
  invalid,
  className,
}: {
  context: VariableFormContext
  value: unknown
  onChange: (next: string) => void
  multiline?: boolean
  id?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  /** The app's own control class, so the field looks like every other input on
   *  the form rather than carrying a second opinion about that. */
  className?: string
}) {
  const text = typeof value === 'string' ? value : ''

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const editableRef = useRef<HTMLDivElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  /** Where the caret should land after the next render the field does. Shared,
   *  because both a completion here and a reference finished by typing there
   *  need it. */
  const caretRequest = useRef<number | null>(null)

  const [draft, setDraft] = useState<VariableDraft | null>(null)
  const [active, setActive] = useState(0)
  const [hovered, setHovered] = useState<{ hint: VariableHint; box: DOMRect } | null>(null)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The draft an Escape closed the menu on, so it stays closed until the
   *  reference being typed actually changes. */
  const dismissed = useRef<string | null>(null)

  const hints = useMemo(() => VariableHints.of(text, context.variables), [text, context.variables])

  const suggestions = useMemo(
    () => (draft ? VariableHints.suggestions(draft, context.variables) : []),
    [draft, context.variables],
  )

  const readSuggestions =
    !disabled && draft !== null && suggestions.length > 0 && dismissed.current !== draftKey(draft)

  /** The caret as an index into the stored string, or null when it is not in
   *  this field. */
  const caretIndex = (): number | null => {
    const host = editableRef.current
    const selection = window.getSelection()
    if (!host || !selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer)) return null
    return VariableDom.caretOffset(host, range.startContainer, range.startOffset)
  }

  const syncDraft = () => {
    if (disabled) {
      setDraft(null)
      return
    }
    const caret = caretIndex()
    const next = caret === null ? null : VariableHints.draftAt(text, caret)

    // The highlighted option is reset only when the list it points into can
    // have changed. Resetting it unconditionally is what made the arrow keys
    // look broken: the keydown moved the cursor and the keyup put it back.
    if (draftKey(next) !== draftKey(draft)) {
      setActive(0)
      dismissed.current = null
    }
    setDraft(next)
  }

  const accept = (variable: Variable) => {
    if (!draft) return
    const completed = VariableHints.complete(text, draft, variable.name)
    caretRequest.current = completed.caret
    setDraft(null)
    onChange(completed.text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!readSuggestions) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (index + step + suggestions.length) % suggestions.length)
      return
    }
    // Enter and Tab both accept, because both are what people reach for; Enter
    // is also submit in a single-line field, so it is only intercepted while
    // the menu is genuinely open.
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      accept(suggestions[active] ?? suggestions[0]!)
      return
    }
    if (event.key === 'Escape') {
      // Stopped here, not just prevented: Escape in the entry form discards the
      // whole form, and closing a menu must not do that.
      event.preventDefault()
      event.stopPropagation()
      dismissed.current = draftKey(draft)
      setDraft(null)
    }
  }

  const keepOpen = () => {
    if (closing.current) clearTimeout(closing.current)
    closing.current = null
  }

  const scheduleClose = () => {
    if (closing.current) clearTimeout(closing.current)
    // Long enough to cross the gap into the popover, short enough not to linger.
    closing.current = setTimeout(() => setHovered(null), 220)
  }

  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current)
    },
    [],
  )

  // A portalled popover is positioned in viewport coordinates, so it would sit
  // still while the field it points at scrolled away. Closing is the honest
  // response; re-measuring on every scroll frame is not worth it for a hint.
  useEffect(() => {
    if (!hovered) return
    const close = () => setHovered(null)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [hovered])

  /**
   * Which chip the pointer is over.
   *
   * A plain `mouseover`, because a chip is now a real element rather than a
   * painted region — which is the one thing the `contenteditable` buys back for
   * the price it charges elsewhere.
   */
  const onPointerOver = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      if (popRef.current?.contains(target)) {
        keepOpen()
        return
      }
      const chip = target?.closest(`[${VariableDom.Attribute}]`) as HTMLElement | null
      if (!chip) {
        scheduleClose()
        return
      }
      const name = chip.getAttribute(VariableDom.Attribute)
      const hint = hints.find((candidate) => candidate.name === name)
      if (!hint) return

      // Viewport coordinates, because the popover is portalled out of this
      // subtree — see where it is rendered for why.
      keepOpen()
      setHovered({ hint, box: chip.getBoundingClientRect() })
    },
    [hints],
  )

  const hint = hovered?.hint

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      onMouseOver={onPointerOver}
      onMouseLeave={scheduleClose}
    >
      <VariableTextField
        id={id}
        value={text}
        onChange={onChange}
        hints={hints}
        env={context.env}
        multiline={multiline}
        editableRef={editableRef}
        caretRequest={caretRequest}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        className={className}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          // Every key except the ones the menu itself consumes: re-reading the
          // caret after an arrow press or an accept would undo what that press
          // just did.
          if (!MenuKeys.has(event.key)) syncDraft()
        }}
        onSelectionChange={syncDraft}
      />

      {readSuggestions && (
        <div className={styles.menu} role="listbox" aria-label="Variables">
          {suggestions.map((variable, index) => (
            <button
              key={variable.name}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`${styles.option} ${index === active ? styles.active : ''}`}
              // `mouseDown`, not `click`: the field's blur fires first and would
              // unmount this before a click could land.
              onMouseDown={(event) => {
                event.preventDefault()
                accept(variable)
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span className={styles.optionName}>{variable.name}</span>
              {variable.value === null ? (
                <span className={styles.optionUnset}>unset in {context.env}</span>
              ) : (
                <span className={styles.optionValue}>{variable.value || '(empty)'}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/*
        Portalled to the body, because the markdown editor's box is
        `overflow: hidden` for its rounded corners and a popover rendered inside
        it is simply cut off. Out here it is positioned in viewport coordinates
        and closes on scroll.
      */}
      {hovered && hint && createPortal(
        <div
          ref={popRef}
          className={styles.pop}
          role="tooltip"
          style={{ left: hovered.box.left, top: hovered.box.bottom + 4 }}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
        >
          <span className={styles.popHead}>{VariableTemplate.spell(hint.name)}</span>

          {hint.state === 'resolved' && (
            <>
              <span className={styles.popValue}>
                {hint.value === '' ? <em>empty string</em> : hint.value}
              </span>
              <span className={styles.popNote}>The API returns this in {context.env}.</span>
            </>
          )}
          {hint.state === 'unset' && (
            <span className={styles.popNote}>
              Declared in this project, but {context.env} has no value. The API returns{' '}
              {VariableTemplate.spell(hint.name)} unchanged.
            </span>
          )}
          {hint.state === 'undeclared' && (
            <span className={styles.popNote}>
              Not declared in this project. The API returns {VariableTemplate.spell(hint.name)}{' '}
              unchanged.
            </span>
          )}

          <Link
            to={context.manageHref}
            className={styles.manage}
            title={`Variables for ${context.env}`}
          >
            <Settings2 size={11} /> Manage values <ExternalLink size={10} />
          </Link>
        </div>,
        document.body,
      )}
    </div>
  )
}
