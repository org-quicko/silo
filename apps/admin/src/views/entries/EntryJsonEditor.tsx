import { useImperativeHandle, useRef, useState } from 'react'
import type React from 'react'
import CodeMirror, { type EditorView } from '@uiw/react-codemirror'
import { json as jsonLang } from '@codemirror/lang-json'
import { AlertCircle, Braces, Check } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { useThemeMode } from '../../utils/use-theme-mode'
import { EntryJsonDocument } from './entry-json-document'
import styles from './EntryJsonEditor.module.css'

export interface EntryJsonEditorProps {
  serverId: string
  value: Record<string, any>
  disabled?: boolean
  onChange: (nextText: string, parsed: Record<string, any> | null, error: string | null) => void
  editorRef?: React.Ref<{ focus: () => void }>
}

/**
 * Full-entry raw JSON editor backed by CodeMirror.
 *
 * Preserves user formatting and invalid intermediate edits in local state so
 * typing never jumps the cursor or gets clobbered by stale props, while
 * syncing cleanly when `value` changes externally while valid.
 */
export function EntryJsonEditor({
  serverId,
  value,
  disabled = false,
  onChange,
  editorRef,
}: EntryJsonEditorProps) {
  const themeMode = useThemeMode(serverId || undefined)
  const nextValueKey = EntryJsonDocument.format(value)
  const [prevValueKey, setPrevValueKey] = useState(nextValueKey)
  const [text, setText] = useState(() => nextValueKey)
  const [error, setError] = useState<string | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  if (nextValueKey !== prevValueKey) {
    setPrevValueKey(nextValueKey)
    if (error === null) {
      const current = EntryJsonDocument.parse(text)
      if (current.ok && EntryJsonDocument.format(current.data) !== nextValueKey) {
        setText(nextValueKey)
      }
    }
  }

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        viewRef.current?.contentDOM?.scrollIntoView?.({ block: 'nearest' })
        viewRef.current?.focus()
      },
    }),
    [],
  )

  const handleChange = (nextText: string) => {
    setText(nextText)
    const parsed = EntryJsonDocument.parse(nextText)
    if (parsed.ok) {
      setError(null)
      onChange(nextText, parsed.data, null)
    } else {
      setError(parsed.error)
      onChange(nextText, null, parsed.error)
    }
  }

  const handleFormat = () => {
    if (disabled) return
    const formatted = EntryJsonDocument.prettyPrint(text)
    if (!formatted.ok) {
      setError(formatted.error)
      onChange(text, null, formatted.error)
      return
    }
    setError(null)
    if (formatted.text === text) return
    setText(formatted.text)
    const parsed = EntryJsonDocument.parse(formatted.text)
    onChange(formatted.text, parsed.ok ? parsed.data : null, parsed.ok ? null : parsed.error)
  }

  const valid = error === null

  return (
    <div className={`${styles.card} ${valid ? '' : styles.cardInvalid}`}>
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.tag}>entry.json</span>
          <span className={styles.hint}>User fields only · templates and explicit nulls preserved</span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleFormat}
          disabled={disabled || !valid}
        >
          <Braces size={13} /> Format JSON
        </Button>
      </div>

      <div className={styles.codeEditor}>
        <CodeMirror
          value={text}
          minHeight="320px"
          maxHeight="640px"
          theme={themeMode}
          extensions={[jsonLang()]}
          editable={!disabled}
          readOnly={disabled}
          basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
          onChange={handleChange}
        />
      </div>

      <div className={`${styles.footer} ${valid ? '' : styles.footerInvalid}`} role={valid ? undefined : 'alert'}>
        {valid ? <Check size={14} /> : <AlertCircle size={14} />}
        <span>{valid ? 'Valid entry JSON' : error}</span>
      </div>
    </div>
  )
}
