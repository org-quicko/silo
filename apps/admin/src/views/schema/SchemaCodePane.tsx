import { useImperativeHandle, useRef, useState } from 'react'
import type React from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { JsonCodeEditor, type JsonCodeEditorHandle } from '../../components/json/JsonCodeEditor'
import { JsonExpandModal } from '../../components/json/JsonExpandModal'
import { JsonToolbar } from '../../components/json/JsonToolbar'
import { JsonSyntax, type JsonDiagnostic } from '../../components/json/json-syntax'
import styles from './SchemaCodePane.module.css'

export interface SchemaCodePaneProps {
  serverId: string
  collectionName: string
  text: string
  disabled: boolean
  diagnostic: JsonDiagnostic | null
  editorRef?: React.Ref<JsonCodeEditorHandle>
  onChange: (nextText: string) => void
}

/**
 * Code-tab editor for `SchemaEditorView`, pairing `JsonCodeEditor` with a
 * non-submitting toolbar (Format, Wrap, Copy, Expand modal) and error jump.
 */
export function SchemaCodePane({
  serverId,
  collectionName,
  text,
  disabled,
  diagnostic,
  editorRef,
  onChange,
}: SchemaCodePaneProps) {
  const [lineWrap, setLineWrap] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const codeEditorRef = useRef<JsonCodeEditorHandle | null>(null)
  const modalCodeEditorRef = useRef<JsonCodeEditorHandle | null>(null)

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
        target?.focus()
      },
      jumpToError: () => {
        const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
        target?.jumpToError()
      },
      jumpToDiagnostic: (targetDiagnostic) => {
        const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
        target?.jumpToDiagnostic(targetDiagnostic)
      },
      replaceText: (nextText) => {
        const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
        if (target) target.replaceText(nextText)
        else onChange(nextText)
      },
    }),
    [expanded, onChange],
  )

  const handleFormat = () => {
    if (disabled) return
    const result = JsonSyntax.format(text)
    if (!result.ok || result.text === text) return
    const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
    if (target) target.replaceText(result.text)
    else onChange(result.text)
  }

  const jumpToError = () => {
    const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
    target?.jumpToError()
  }

  const valid = diagnostic === null

  const renderToolbar = (inModal: boolean) => (
    <JsonToolbar
      text={text}
      locked={disabled}
      invalid={!valid}
      empty={text.trim() === ''}
      lineWrap={lineWrap}
      onFormat={handleFormat}
      onToggleWrap={() => setLineWrap((previous) => !previous)}
      onExpand={inModal ? undefined : () => setExpanded(true)}
    />
  )

  return (
    <div className={styles.root}>
      <div className={styles.subtoolbar}>
        <span className={styles.hint}>JSON Schema draft 2020-12 · ⌘F / Ctrl+F to find</span>
        {renderToolbar(false)}
      </div>

      <JsonCodeEditor
        value={text}
        height="420px"
        serverId={serverId}
        disabled={disabled}
        diagnostic={diagnostic}
        lineWrap={lineWrap}
        editorRef={codeEditorRef}
        onChange={onChange}
      />

      {expanded && (
        <JsonExpandModal
          title={`${collectionName || 'untitled'} · schema.json`}
          subtitle="JSON Schema draft 2020-12"
          toolbar={renderToolbar(true)}
          footer={
            <div className={`${styles.modalFooter} ${valid ? '' : styles.modalFooterInvalid}`}>
              <div className={styles.modalStatus}>
                {valid ? <Check size={14} /> : <AlertCircle size={14} />}
                <span>
                  {valid
                    ? 'Valid JSON syntax'
                    : `Line ${diagnostic.line}, Col ${diagnostic.column} · ${diagnostic.message}`}
                </span>
              </div>
              {!valid && (
                <button type="button" className={styles.jumpButton} onClick={jumpToError}>
                  Jump to error
                </button>
              )}
            </div>
          }
          onClose={() => setExpanded(false)}
        >
          <JsonCodeEditor
            value={text}
            height="100%"
            minHeight="440px"
            serverId={serverId}
            disabled={disabled}
            diagnostic={diagnostic}
            lineWrap={lineWrap}
            editorRef={modalCodeEditorRef}
            onChange={onChange}
          />
        </JsonExpandModal>
      )}
    </div>
  )
}
