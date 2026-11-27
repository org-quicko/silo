import { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type React from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json as jsonLang } from '@codemirror/lang-json'
import { useThemeMode } from '../../utils/use-theme-mode'
import { JsonDiagnosticsExtension } from './json-diagnostics-extension'
import { JsonSyntax, type JsonDiagnostic } from './json-syntax'
import styles from './JsonCodeEditor.module.css'

export interface JsonCodeEditorHandle {
  focus: () => void
  jumpToError: () => void
  jumpToDiagnostic: (diagnostic: JsonDiagnostic) => void
  replaceText: (nextText: string) => void
}

export interface JsonCodeEditorProps {
  value: string
  onChange: (nextText: string) => void
  serverId?: string
  disabled?: boolean
  placeholder?: string
  minHeight?: string
  maxHeight?: string
  height?: string
  /** Single diagnostic override; `null` suppresses automatic syntax checks. */
  diagnostic?: JsonDiagnostic | null
  /** Multi-diagnostic override (takes precedence over `diagnostic`; `[]` suppresses automatic checks). */
  diagnostics?: readonly JsonDiagnostic[]
  allowEmpty?: boolean
  lineWrap?: boolean
  onCreateEditor?: (view: EditorView) => void
  editorRef?: React.Ref<JsonCodeEditorHandle>
}

/**
 * Shared CodeMirror 6 JSON editor with bracket matching, code folding,
 * search (`⌘F` / `Ctrl+F`), optional line wrapping, and inline syntax/schema
 * diagnostics.
 */
export function JsonCodeEditor({
  value,
  onChange,
  serverId,
  disabled = false,
  placeholder,
  minHeight = '140px',
  maxHeight = '420px',
  height,
  diagnostic,
  diagnostics,
  allowEmpty = false,
  lineWrap = false,
  onCreateEditor,
  editorRef,
}: JsonCodeEditorProps) {
  const themeMode = useThemeMode(serverId || undefined)
  const viewRef = useRef<EditorView | null>(null)

  const resolvedDiagnostics = useMemo<readonly JsonDiagnostic[]>(() => {
    if (diagnostics !== undefined) {
      return [...diagnostics].sort((left, right) => left.from - right.from || left.to - right.to)
    }
    if (diagnostic !== undefined) {
      return diagnostic ? [diagnostic] : []
    }
    const autoDiagnostic = JsonSyntax.diagnose(value, { allowEmpty })
    return autoDiagnostic ? [autoDiagnostic] : []
  }, [diagnostics, diagnostic, value, allowEmpty])

  const diagnosticsRef = useRef<readonly JsonDiagnostic[]>(resolvedDiagnostics)

  useEffect(() => {
    diagnosticsRef.current = resolvedDiagnostics
    JsonDiagnosticsExtension.sync(viewRef.current, resolvedDiagnostics)
  }, [resolvedDiagnostics])

  const extensions = useMemo(() => {
    const list = [jsonLang(), ...JsonDiagnosticsExtension.extensions()]
    if (lineWrap) {
      list.push(EditorView.lineWrapping)
    }
    return list
  }, [lineWrap])

  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        viewRef.current?.contentDOM?.scrollIntoView?.({ block: 'nearest' })
        viewRef.current?.focus()
      },
      jumpToError: () => {
        JsonDiagnosticsExtension.jumpTo(viewRef.current, diagnosticsRef.current[0] ?? null)
      },
      jumpToDiagnostic: (target: JsonDiagnostic) => {
        JsonDiagnosticsExtension.jumpTo(viewRef.current, target)
      },
      replaceText: (nextText: string) => {
        const view = viewRef.current
        if (!view) {
          onChangeRef.current(nextText)
          return
        }
        const current = view.state.doc.toString()
        if (current === nextText) return
        view.dispatch({
          changes: { from: 0, to: current.length, insert: nextText },
        })
      },
    }),
    [],
  )

  return (
    <div className={styles.root}>
      <CodeMirror
        value={value}
        height={height}
        minHeight={height ? undefined : minHeight}
        maxHeight={height ? undefined : maxHeight}
        theme={themeMode}
        extensions={extensions}
        editable={!disabled}
        readOnly={disabled}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
          history: true,
          autocompletion: false,
        }}
        onCreateEditor={(view) => {
          viewRef.current = view
          JsonDiagnosticsExtension.sync(view, diagnosticsRef.current)
          onCreateEditor?.(view)
        }}
        onChange={onChange}
      />
    </div>
  )
}
