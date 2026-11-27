import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Code2, ListTree } from 'lucide-react'
import { JsonCodeEditor, type JsonCodeEditorHandle } from '../../components/json/JsonCodeEditor'
import { JsonExpandModal } from '../../components/json/JsonExpandModal'
import { JsonToolbar } from '../../components/json/JsonToolbar'
import { JsonVisualEditor } from '../../components/json/JsonVisualEditor'
import { JsonSyntax } from '../../components/json/json-syntax'
import { JsonValue } from '../../components/json/json-value'
import { Segmented } from '../../components/controls/Segmented'
import { SiloRefs } from '../../schema/silo-refs'
import { ArrayItemHeaderContext } from '../templates/ArrayItemHeaderContext'
import styles from './JsonField.module.css'

type JsonFieldMode = 'visual' | 'code'

// JsonField: dual-mode Visual Tree + CodeMirror editor for `any` fields and
// unrenderable subtrees (oneOf/anyOf/opaque objects/unresolved refs, D3).
// Implemented as a Field (not a Widget) so it replaces RJSF's handling for
// the subtree — the whole value is edited here and validated by the server.
export function JsonField(props: any) {
  const {
    name,
    schema,
    formData,
    onChange,
    fieldPathId,
    disabled,
    readonly,
    registry,
    formContext,
    rawErrors,
  } = props
  const context = registry?.formContext ?? formContext
  const serverId = typeof context?.serverId === 'string' && context.serverId ? context.serverId : undefined
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
  const [text, setText] = useState(() =>
    formData === undefined ? '' : JSON.stringify(formData, null, 2),
  )
  const [mode, setMode] = useState<JsonFieldMode>(() =>
    JsonValue.countNodes(formData, 201) <= 200 ? 'visual' : 'code',
  )
  const [lineWrap, setLineWrap] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [switchError, setSwitchError] = useState('')

  const cardRef = useRef<HTMLDivElement | null>(null)
  const codeEditorRef = useRef<JsonCodeEditorHandle | null>(null)
  const modalCodeEditorRef = useRef<JsonCodeEditorHandle | null>(null)
  const validityCallbackRef = useRef(onJsonValidityChange)

  const diagnostic = useMemo(
    () => (mode === 'code' ? JsonSyntax.diagnose(text, { allowEmpty: true }) : null),
    [mode, text],
  )

  if (incomingKey !== prevFormDataKey) {
    setPrevFormDataKey(incomingKey)
    if (diagnostic === null) {
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
        setSwitchError('')
      }
    }
  }

  const jumpToCodeError = useCallback(() => {
    if (expanded && modalCodeEditorRef.current) {
      modalCodeEditorRef.current.jumpToError()
      return
    }
    if (codeEditorRef.current) {
      codeEditorRef.current.jumpToError()
      return
    }
    cardRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded])

  useEffect(() => {
    validityCallbackRef.current = onJsonValidityChange
  }, [onJsonValidityChange])

  const invalid = mode === 'code' && diagnostic !== null
  useEffect(() => {
    validityCallbackRef.current?.(fieldKey, invalid, jumpToCodeError)
    return () => {
      validityCallbackRef.current?.(fieldKey, false, jumpToCodeError)
    }
  }, [fieldKey, invalid, jumpToCodeError])

  // RJSF v6 field onChange signature is (value, path, …); omitting the path
  // makes the Form merge the value at the ROOT of formData instead of here.
  const emit = (value: any) => onChange(value, fieldPathId?.path)

  const handleCodeChange = (nextText: string) => {
    setText(nextText)
    if (switchError) setSwitchError('')
    if (nextText.trim() === '') {
      emit(undefined)
      return
    }
    try {
      const parsed = JSON.parse(nextText)
      emit(parsed)
    } catch {
      /* keep invalid text local until syntax is valid */
    }
  }

  const handleVisualChange = (nextValue: unknown) => {
    setSwitchError('')
    setText(nextValue === undefined ? '' : JSON.stringify(nextValue, null, 2))
    emit(nextValue)
  }

  const handleSwitchMode = (nextMode: JsonFieldMode) => {
    if (nextMode === mode) return
    if (nextMode === 'code') {
      setText(formData === undefined ? '' : JSON.stringify(formData, null, 2))
      setSwitchError('')
      setMode('code')
      return
    }

    if (diagnostic !== null) {
      setSwitchError('Fix invalid JSON before switching to Visual mode.')
      jumpToCodeError()
      return
    }

    setSwitchError('')
    if (text.trim() === '') {
      emit(undefined)
    } else {
      emit(JSON.parse(text))
    }
    setMode('visual')
  }

  const applyCodeReplacement = (nextText: string) => {
    if (nextText === text) return
    const target = expanded && modalCodeEditorRef.current ? modalCodeEditorRef.current : codeEditorRef.current
    if (target) target.replaceText(nextText)
    else handleCodeChange(nextText)
  }

  const handleFormat = () => {
    if (locked || text.trim() === '') return
    const result = JsonSyntax.format(text)
    if (result.ok) applyCodeReplacement(result.text)
  }

  const handleMinify = () => {
    if (locked || text.trim() === '') return
    const result = JsonSyntax.minify(text)
    if (result.ok) applyCodeReplacement(result.text)
  }

  const handleSortKeys = () => {
    if (locked || text.trim() === '') return
    const result = JsonSyntax.sortKeysInText(text)
    if (result.ok) applyCodeReplacement(result.text)
  }

  const marker: string | undefined = schema?.[SiloRefs.markerKey]
  const markerKind: string | undefined = schema?.[SiloRefs.markerKindKey]
  // A property that constrains nothing is not a subtree the form failed to
  // draw — it is a field that accepts any JSON, which this editor is the right
  // control for rather than the fallback from one.
  const typeLabel = Array.isArray(schema?.type)
    ? schema.type.join(' | ')
    : typeof schema?.type === 'string'
      ? schema.type
      : ''
  const kind = marker
    ? 'reference'
    : schema?.oneOf
      ? 'oneOf'
      : schema?.anyOf
        ? 'anyOf'
        : schema?.allOf
          ? 'allOf'
          : ''
  const any = !kind && !typeLabel
  const fieldHint = any
    ? 'any · JSON'
    : !kind
      ? `${typeLabel} · JSON`
      : typeLabel
        ? `${typeLabel} · ${kind}`
        : kind
  const fallbackNotice =
    markerKind === 'remote' ? (
      <span>
        References a remote schema — <span className="mono">{marker}</span>. The form can't fetch it, so edit this
        value as JSON; silo validates on save (the server needs <span className="mono">allow_remote_refs</span> to
        fetch it).
      </span>
    ) : markerKind === 'cycle' ? (
      <span>
        Recursive reference (<span className="mono">{marker}</span>) — the form can't render it inline. Edit it as
        JSON; silo validates on save.
      </span>
    ) : markerKind === 'missing' ? (
      <span>
        References <span className="mono">{marker}</span>, which doesn't match a collection on this server. Edit it as
        JSON; silo validates on save.
      </span>
    ) : null

  const liveSerialized =
    mode === 'visual'
      ? formData === undefined
        ? ''
        : JSON.stringify(formData, null, 2)
      : text
  const codeEmpty = text.trim() === ''
  const summaryLabel = invalid ? 'Invalid JSON' : JsonSyntax.summarize(formData)
  const preferObject = schema?.type === 'object' || (Array.isArray(schema?.type) && schema.type.includes('object'))

  const renderModeToggle = () => (
    <Segmented
      value={mode}
      variant="compact"
      onChange={handleSwitchMode}
      options={[
        {
          value: 'visual',
          label: (
            <>
              <ListTree size={12} /> Visual
            </>
          ),
        },
        {
          value: 'code',
          label: (
            <>
              <Code2 size={12} /> Code
            </>
          ),
        },
      ]}
    />
  )

  const renderToolbar = (inModal: boolean) => (
    <JsonToolbar
      text={liveSerialized}
      locked={locked}
      invalid={invalid}
      empty={mode === 'visual' ? formData === undefined : codeEmpty}
      lineWrap={lineWrap}
      onFormat={mode === 'code' ? handleFormat : undefined}
      onMinify={mode === 'code' ? handleMinify : undefined}
      onSortKeys={mode === 'code' ? handleSortKeys : undefined}
      onToggleWrap={mode === 'code' ? () => setLineWrap((previous) => !previous) : undefined}
      onExpand={inModal ? undefined : () => setExpanded(true)}
    />
  )

  const renderErrorBar = () => {
    if (!diagnostic && !switchError) return null
    return (
      <div className={styles.errorBar} role="alert">
        <div className={styles.errorCopy}>
          <AlertCircle size={13} />
          <span>
            {diagnostic
              ? `Line ${diagnostic.line}, Col ${diagnostic.column} · ${diagnostic.message}`
              : switchError}
            {diagnostic && switchError ? ` — ${switchError}` : ''}
          </span>
        </div>
        {diagnostic && (
          <button type="button" className={styles.jumpButton} onClick={jumpToCodeError}>
            Jump to error
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="field">
      <div className="field-label-row">
        {!headed && <label className="field-label">{schema?.title || name}</label>}
        <span className={`field-hint ${marker ? 'warn' : ''}`}>{fieldHint}</span>
      </div>

      <div ref={cardRef} className={`${styles.editor} ${invalid ? styles.editorInvalid : ''}`}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {renderModeToggle()}
            <span className={`${styles.summaryPill} ${invalid ? styles.summaryInvalid : ''}`}>
              {summaryLabel}
            </span>
          </div>
          {renderToolbar(false)}
        </div>

        {fallbackNotice && (
          <div className={styles.notice}>
            <AlertTriangle size={14} />
            <div className={styles.noticeCopy}>{fallbackNotice}</div>
          </div>
        )}

        {mode === 'visual' ? (
          <JsonVisualEditor
            value={formData}
            disabled={locked}
            preferObject={Boolean(preferObject)}
            maxHeight="360px"
            onChange={handleVisualChange}
          />
        ) : (
          <JsonCodeEditor
            value={text}
            serverId={serverId}
            disabled={locked}
            placeholder="{ }"
            minHeight="140px"
            maxHeight="360px"
            diagnostic={diagnostic}
            allowEmpty
            lineWrap={lineWrap}
            editorRef={codeEditorRef}
            onChange={handleCodeChange}
          />
        )}

        {renderErrorBar()}
      </div>

      {Array.isArray(rawErrors) && rawErrors.length > 0 && (
        <div className="field-error">
          <AlertCircle size={13} />
          <span>{rawErrors[0]}</span>
        </div>
      )}

      {expanded && (
        <JsonExpandModal
          title={schema?.title || name || 'JSON value'}
          subtitle={fieldHint}
          headerControls={renderModeToggle()}
          toolbar={renderToolbar(true)}
          footer={renderErrorBar()}
          onClose={() => setExpanded(false)}
        >
          {mode === 'visual' ? (
            <JsonVisualEditor
              value={formData}
              disabled={locked}
              preferObject={Boolean(preferObject)}
              onChange={handleVisualChange}
            />
          ) : (
            <JsonCodeEditor
              value={text}
              serverId={serverId}
              disabled={locked}
              placeholder="{ }"
              height="100%"
              minHeight="420px"
              diagnostic={diagnostic}
              allowEmpty
              lineWrap={lineWrap}
              editorRef={modalCodeEditorRef}
              onChange={handleCodeChange}
            />
          )}
        </JsonExpandModal>
      )}
    </div>
  )
}
