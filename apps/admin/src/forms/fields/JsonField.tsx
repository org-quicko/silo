import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import CodeMirror, { type EditorView } from '@uiw/react-codemirror'
import { json as jsonLang } from '@codemirror/lang-json'
import { AlertCircle, AlertTriangle, Braces } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { SiloRefs } from '../../schema/silo-refs'
import { useThemeMode } from '../../utils/use-theme-mode'
import { ArrayItemHeaderContext } from '../templates/ArrayItemHeaderContext'
import styles from './JsonField.module.css'

// JsonField: raw-JSON fallback for oneOf/anyOf/opaque objects (D3). Implemented
// as a Field (not a Widget) so it fully replaces RJSF's oneOf/anyOf handling for
// the subtree — the whole value is edited as JSON and validated by the server.
export function JsonField(props: any) {
  const { name, schema, formData, onChange, fieldPathId, disabled, readonly, registry, formContext } = props
  const context = registry?.formContext ?? formContext
  const serverId = typeof context?.serverId === 'string' && context.serverId ? context.serverId : undefined
  const themeMode = useThemeMode(serverId)
  const onJsonValidityChange = context?.onJsonValidityChange as
    | ((fieldKey: string, invalid: boolean, focus: () => void) => void)
    | undefined
  const fieldKey = Array.isArray(fieldPathId?.path)
    ? JSON.stringify(fieldPathId.path)
    : fieldPathId?.$id || name || ''

  // An unresolved ref inside an array is titled by the item's collapsible
  // header; repeating RJSF's "<array>-<index>" name under it says nothing.
  const headed = useContext(ArrayItemHeaderContext) === fieldPathId?.$id
  const locked = Boolean(disabled || readonly)

  const incomingKey = formData === undefined ? undefined : JSON.stringify(formData)
  const [prevFormDataKey, setPrevFormDataKey] = useState(incomingKey)
  const [text, setText] = useState(() => (formData === undefined ? '' : JSON.stringify(formData, null, 2)))
  const [parseError, setParseError] = useState<string | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const validityCallbackRef = useRef(onJsonValidityChange)

  if (incomingKey !== prevFormDataKey) {
    setPrevFormDataKey(incomingKey)
    if (parseError === null) {
      let currentKey: string | undefined
      let textValid = true
      if (text.trim() !== '') {
        try {
          currentKey = JSON.stringify(JSON.parse(text))
        } catch {
          textValid = false
        }
      }
      if (textValid && incomingKey !== currentKey) {
        setText(formData === undefined ? '' : JSON.stringify(formData, null, 2))
      }
    }
  }

  const focusEditor = useCallback(() => {
    viewRef.current?.contentDOM?.scrollIntoView?.({ block: 'nearest' })
    viewRef.current?.focus()
  }, [])

  useEffect(() => {
    validityCallbackRef.current = onJsonValidityChange
  }, [onJsonValidityChange])

  const invalid = parseError !== null
  useEffect(() => {
    validityCallbackRef.current?.(fieldKey, invalid, focusEditor)
    return () => {
      validityCallbackRef.current?.(fieldKey, false, focusEditor)
    }
  }, [fieldKey, invalid, focusEditor])

  // RJSF v6 field onChange signature is (value, path, …); omitting the path
  // makes the Form merge the value at the ROOT of formData instead of here.
  const emit = (value: any) => onChange(value, fieldPathId?.path)

  const handleChange = (nextText: string) => {
    setText(nextText)
    if (nextText.trim() === '') {
      setParseError(null)
      emit(undefined)
      return
    }
    try {
      const parsed = JSON.parse(nextText)
      setParseError(null)
      emit(parsed)
    } catch (caught) {
      setParseError(caught instanceof Error ? caught.message : 'Invalid JSON')
    }
  }

  const handleFormat = () => {
    if (locked || text.trim() === '') return
    try {
      const parsed = JSON.parse(text)
      setText(JSON.stringify(parsed, null, 2))
      setParseError(null)
    } catch (caught) {
      setParseError(caught instanceof Error ? caught.message : 'Invalid JSON')
    }
  }

  const marker: string | undefined = schema?.[SiloRefs.markerKey]
  const markerKind: string | undefined = schema?.[SiloRefs.markerKindKey]
  // A property that constrains nothing is not a subtree the form failed to
  // draw — it is a field that accepts any JSON, which this editor is the right
  // control for rather than the fallback from one. It reads as such.
  const any = !marker && !schema?.oneOf && !schema?.anyOf && !schema?.type
  const kind = marker ? 'reference' : schema?.oneOf ? 'oneOf' : schema?.anyOf ? 'anyOf' : schema?.type || 'any'
  const notice =
    markerKind === 'remote' ? (
      <span>
        References a remote schema — <span className="mono">{marker}</span>. The form can't fetch it, so edit this
        value as raw JSON; silo validates on save (the server needs <span className="mono">allow_remote_refs</span> to
        fetch it).
      </span>
    ) : markerKind === 'cycle' ? (
      <span>
        Recursive reference (<span className="mono">{marker}</span>) — the form can't render it inline. Edit it as raw
        JSON; silo validates on save.
      </span>
    ) : markerKind === 'missing' ? (
      <span>
        References <span className="mono">{marker}</span>, which doesn't match a collection on this server. Edit it as
        raw JSON; silo validates on save.
      </span>
    ) : any ? (
      <span>Any JSON value: an object, a list, a string, a number, or nothing.</span>
    ) : (
      <span>This subtree has no simple control. Edit it as raw JSON — silo validates on save.</span>
    )

  return (
    <div className="field">
      <div className="field-label-row">
        {!headed && <label className="field-label">{schema?.title || name}</label>}
        <span className={`field-hint ${any ? '' : 'warn'}`}>
          {any ? 'any · JSON' : `${schema?.type ? `${schema.type} · ` : ''}${kind} — no generated control`}
        </span>
      </div>
      <div className={`${styles.editor} ${invalid ? styles.editorInvalid : ''}`}>
        <div className={`${styles.notice} ${any ? styles.plain : ''}`}>
          <div className={styles.noticeCopy}>
            {any ? <Braces size={14} /> : <AlertTriangle size={14} />}
            {notice}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleFormat}
            disabled={locked || invalid || text.trim() === ''}
          >
            <Braces size={12} /> Format
          </Button>
        </div>
        <div className={styles.code}>
          <CodeMirror
            value={text}
            minHeight="120px"
            maxHeight="360px"
            theme={themeMode}
            extensions={[jsonLang()]}
            editable={!locked}
            readOnly={locked}
            placeholder="{ }"
            basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }}
            onCreateEditor={(view) => {
              viewRef.current = view
            }}
            onChange={handleChange}
          />
        </div>
        {parseError && (
          <div className={styles.errorBar} role="alert">
            <AlertCircle size={13} />
            <span>Invalid JSON: {parseError}</span>
          </div>
        )}
      </div>
    </div>
  )
}
