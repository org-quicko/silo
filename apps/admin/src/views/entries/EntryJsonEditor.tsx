import { useImperativeHandle, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { JsonCodeEditor, type JsonCodeEditorHandle } from '../../components/json/JsonCodeEditor'
import { JsonExpandModal } from '../../components/json/JsonExpandModal'
import { JsonToolbar } from '../../components/json/JsonToolbar'
import { JsonSyntax, type JsonDiagnostic } from '../../components/json/json-syntax'
import { ByteSize } from '../../utils/byte-size'
import type { EntryJsonValidationResult } from './entry-json-validator'
import styles from './EntryJsonEditor.module.css'

export interface EntryJsonEditorProps {
  serverId: string
  text: string
  validation: EntryJsonValidationResult
  disabled?: boolean
  onChange: (nextText: string) => void
  editorRef?: React.Ref<{ focus: () => void }>
}

const MAX_COLLAPSED_ERRORS = 5

/**
 * Full-entry raw JSON editor backed by `JsonCodeEditor` with live strict schema
 * diagnostics, clickable error jump list, syntax formatting/compacting/key-sorting
 * tools, and an `xl` expand modal.
 */
export function EntryJsonEditor({
  serverId,
  text,
  validation,
  disabled = false,
  onChange,
  editorRef,
}: EntryJsonEditorProps) {
  const [lineWrap, setLineWrap] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showAllErrors, setShowAllErrors] = useState(false)

  const codeEditorRef = useRef<JsonCodeEditorHandle | null>(null)
  const modalCodeEditorRef = useRef<JsonCodeEditorHandle | null>(null)

  const activeEditor = () =>
    expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
        if (!validation.ok && validation.diagnostics.length > 0) {
          target?.jumpToError()
        } else {
          target?.focus()
        }
      },
    }),
    [expanded, validation],
  )

  const syntaxValid = validation.kind !== 'syntax' && text.trim() !== ''

  const applyTextReplacement = (nextText: string) => {
    if (nextText === text) return
    const target = activeEditor()
    if (target) target.replaceText(nextText)
    else onChange(nextText)
  }

  const handleFormat = () => {
    if (disabled || !syntaxValid) return
    const result = JsonSyntax.format(text)
    if (result.ok) applyTextReplacement(result.text)
  }

  const handleMinify = () => {
    if (disabled || !syntaxValid) return
    const result = JsonSyntax.minify(text)
    if (result.ok) applyTextReplacement(result.text)
  }

  const handleSortKeys = () => {
    if (disabled || !syntaxValid) return
    const result = JsonSyntax.sortKeysInText(text)
    if (result.ok) applyTextReplacement(result.text)
  }

  const jumpToDiagnostic = (diagnostic: JsonDiagnostic) => {
    activeEditor()?.jumpToDiagnostic(diagnostic)
  }

  const valid = validation.ok
  const metrics = useMemo(() => JsonSyntax.measure(text), [text])
  const diagnostics = validation.diagnostics
  const visibleDiagnostics = showAllErrors
    ? diagnostics
    : diagnostics.slice(0, MAX_COLLAPSED_ERRORS)
  const hiddenCount = diagnostics.length - visibleDiagnostics.length

  const renderToolbar = (inModal: boolean) => (
    <JsonToolbar
      text={text}
      locked={disabled}
      invalid={!syntaxValid}
      empty={text.trim() === ''}
      lineWrap={lineWrap}
      onFormat={handleFormat}
      onMinify={handleMinify}
      onSortKeys={handleSortKeys}
      onToggleWrap={() => setLineWrap((previous) => !previous)}
      onExpand={inModal ? undefined : () => setExpanded(true)}
    />
  )

  const renderFooter = (inModal: boolean) => {
    const announce = !valid && inModal === expanded
    return (
      <div
        className={`${styles.footer} ${valid ? '' : styles.footerInvalid}`}
        role={announce ? 'alert' : undefined}
      >
        <div className={styles.footerSummaryRow}>
          <div className={styles.footerStatus}>
            {valid ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>
              {valid
                ? validation.uncheckedRefs.length > 0
                  ? 'Valid entry JSON · external $ref checked on save'
                  : 'Valid entry JSON · matches schema'
                : diagnostics.length > 1
                  ? `${diagnostics.length} validation errors`
                  : diagnostics.length === 1
                    ? `Line ${diagnostics[0].line}, Col ${diagnostics[0].column} · ${diagnostics[0].message}`
                    : validation.error || 'Entry does not match collection schema.'}
            </span>
          </div>
          {valid ? (
            <span className={styles.metrics}>
              {metrics.lines} {metrics.lines === 1 ? 'line' : 'lines'} · {ByteSize.format(metrics.bytes)}
            </span>
          ) : (
            diagnostics.length > 0 && (
              <button
                type="button"
                className={styles.jumpButton}
                onClick={() => activeEditor()?.jumpToError()}
              >
                Jump to error
              </button>
            )
          )}
        </div>

        {!valid && diagnostics.length > 1 && (
          <div className={styles.errorList}>
            {visibleDiagnostics.map((item, index) => (
              <button
                key={`${item.from}:${item.to}:${index}`}
                type="button"
                className={styles.errorItem}
                onClick={() => jumpToDiagnostic(item)}
              >
                <span className={styles.errorLoc}>
                  Ln {item.line}, Col {item.column}
                </span>
                <span className={styles.errorMsg}>{item.message}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className={styles.showMoreButton}
                onClick={() => setShowAllErrors(true)}
              >
                Show {hiddenCount} more {hiddenCount === 1 ? 'error' : 'errors'}
              </button>
            )}
            {showAllErrors && diagnostics.length > MAX_COLLAPSED_ERRORS && (
              <button
                type="button"
                className={styles.showMoreButton}
                onClick={() => setShowAllErrors(false)}
              >
                Show fewer
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`${styles.card} ${valid ? '' : styles.cardInvalid}`}>
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.tag}>entry.json</span>
          <span className={styles.hint}>
            User fields only · schema-checked · templates &amp; explicit nulls preserved
          </span>
        </div>
        {renderToolbar(false)}
      </div>

      <JsonCodeEditor
        value={text}
        serverId={serverId}
        disabled={disabled}
        minHeight="320px"
        maxHeight="640px"
        diagnostics={diagnostics}
        lineWrap={lineWrap}
        editorRef={codeEditorRef}
        onChange={onChange}
      />

      {renderFooter(false)}

      {expanded && (
        <JsonExpandModal
          title="entry.json"
          subtitle="User fields only · schema-checked"
          toolbar={renderToolbar(true)}
          footer={renderFooter(true)}
          onClose={() => setExpanded(false)}
        >
          <JsonCodeEditor
            value={text}
            serverId={serverId}
            disabled={disabled}
            height="100%"
            minHeight="440px"
            diagnostics={diagnostics}
            lineWrap={lineWrap}
            editorRef={modalCodeEditorRef}
            onChange={onChange}
          />
        </JsonExpandModal>
      )}
    </div>
  )
}
