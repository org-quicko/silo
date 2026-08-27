import { useMemo, useState } from 'react'
import { SchemaAccess } from '@silo/shared/schema-access'
import type { Collection } from '../../api/types/collection'
import { SchemaDraft } from '../../schema/schema-draft'
import type { SchemaField } from '../../schema/schema-field'

/** Which half of the editor is in front. */
export type SchemaEditorMode = 'visual' | 'code'

/**
 * The editable schema, in both representations at once.
 *
 * The JSON text is authoritative — it is what gets saved — and the field list
 * is a view of it that the visual builder writes back through. Switching to the
 * visual mode is therefore the one operation that can fail, because it has to
 * parse.
 */
export function useSchemaDraft(collection: Collection | null) {
  const initial = useMemo(() => {
    const text = JSON.stringify(collection ? collection.schema : SchemaDraft.Default, null, 2)
    return { text, ...SchemaDraft.parse(text) }
  }, [collection])

  const [mode, setMode] = useState<SchemaEditorMode>('visual')
  const [text, setText] = useState(initial.text)
  const [base, setBase] = useState<any>(initial.base)
  const [fields, setFields] = useState<SchemaField[]>(initial.fields)
  const [auth, setAuth] = useState(initial.auth)
  const [expanded, setExpanded] = useState<number | null>(null)

  const parsed = useMemo(() => SchemaDraft.parse(text), [text])

  const applyFields = (next: SchemaField[]) => {
    setFields(next)
    setText(SchemaDraft.build(base, next, auth))
  }

  const setRequiresAuth = (required: boolean) => {
    setAuth(required)
    if (mode === 'visual') {
      setText(SchemaDraft.build(base, fields, required))
      return
    }
    try {
      const document = JSON.parse(text)
      SchemaAccess.setRequiresAuth(document, required)
      setText(JSON.stringify(document, null, 2))
    } catch {
      /* leave invalid text for the author to fix */
    }
  }

  /** Returns false when the JSON does not parse, so the caller can say why. */
  const switchMode = (next: SchemaEditorMode): boolean => {
    if (next === 'visual') {
      const reparsed = SchemaDraft.parse(text)
      if (!reparsed.ok) return false
      setBase(reparsed.base)
      setFields(reparsed.fields)
      setAuth(reparsed.auth)
    }
    setMode(next)
    return true
  }

  return {
    mode,
    text,
    setText,
    fields,
    parsed,
    expanded,
    setExpanded,
    /** What the header counts, from whichever representation is in front. */
    fieldCount:
      mode === 'visual'
        ? fields.filter((field) => field.name.trim()).length
        : Object.keys(parsed.base?.properties || {}).length,
    requiresAuth: mode === 'visual' ? auth : parsed.auth,
    setRequiresAuth,
    switchMode,
    updateField: (index: number, patch: Partial<SchemaField>) =>
      applyFields(fields.map((field, at) => (at === index ? { ...field, ...patch } : field))),
    addField: () => {
      const next = [...fields, SchemaDraft.blankField()]
      applyFields(next)
      setExpanded(next.length - 1)
    },
    removeField: (index: number) => {
      applyFields(fields.filter((_, at) => at !== index))
      setExpanded(null)
    },
    /** The document a save should send. */
    toSave: () => (mode === 'visual' ? SchemaDraft.build(base, fields, auth) : text),
  }
}
