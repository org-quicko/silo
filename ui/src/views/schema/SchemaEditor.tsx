import { Button } from '../../components/Button'
import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json as jsonLang } from '@codemirror/lang-json'
import { GripVertical, Settings, Check, AlertCircle, Plus, List, Code2, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { MediaField } from '@silo/shared/media-field'
import { SchemaAccess } from '@silo/shared/schema-access'
import { SiloRef } from '@silo/shared/silo-ref'
import { api } from '../../api/api-client'
import type { Collection } from '../../api/types/collection'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Toggle } from '../../components/Toggle'
import { Segmented } from '../../components/Segmented'
import { TopBar } from '../shell/TopBar'
import { RefTarget } from './RefTarget'
import { EnumValues } from './EnumValues'
import styles from './SchemaEditor.module.css'

type Kind = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'enum' | 'ref' | 'ref-array' | 'media'

interface Field {
  name: string
  kind: Kind
  required: boolean
  description: string
  enumValues: string[]
  refTarget: string // $ref URL: silo://collections/<name> or https://…
  raw: any // original property JSON, so unknown keywords survive round-trips
  construct?: 'oneOf' | 'anyOf' | 'allOf' // advanced subtree the visual builder leaves intact
}

const KIND_LABEL: Record<Kind, string> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  enum: 'enum',
  ref: 'reference',
  'ref-array': 'reference list',
  media: 'media',
}

const DEFAULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['title'],
  properties: { title: { type: 'string' } },
}

function propToField(name: string, prop: any, required: boolean): Field {
  const refTarget = typeof prop?.$ref === 'string' ? prop.$ref : ''
  const itemsRef = typeof prop?.$ref !== 'string' && prop?.type === 'array' && typeof prop?.items?.$ref === 'string' ? prop.items.$ref : ''
  let kind: Kind = 'string'
  if (MediaField.is(prop)) kind = 'media'
  else if (refTarget) kind = 'ref'
  else if (itemsRef) kind = 'ref-array'
  else if (prop?.enum) kind = 'enum'
  else if (prop?.type && KIND_LABEL[prop.type as Kind]) kind = prop.type
  const construct = refTarget || itemsRef ? undefined : prop?.oneOf ? 'oneOf' : prop?.anyOf ? 'anyOf' : prop?.allOf ? 'allOf' : undefined
  return {
    name,
    kind,
    required,
    description: prop?.description || '',
    enumValues: Array.isArray(prop?.enum) ? prop.enum.map(String) : [],
    refTarget: refTarget || itemsRef,
    raw: prop || {},
    construct,
  }
}

function parseSchema(text: string): { base: any; fields: Field[]; auth: boolean; ok: boolean } {
  try {
    const doc = JSON.parse(text)
    if (!doc || typeof doc !== 'object') return { base: {}, fields: [], auth: false, ok: false }
    const props = doc.properties || {}
    const req: string[] = Array.isArray(doc.required) ? doc.required : []
    const fields = Object.keys(props).map((k) => propToField(k, props[k], req.includes(k)))
    return { base: doc, fields, auth: SchemaAccess.requiresAuth(doc), ok: true }
  } catch {
    return { base: {}, fields: [], auth: false, ok: false }
  }
}

function fieldToProp(f: Field): any {
  const out: any = { ...(f.raw || {}) }
  // Advanced constructs (oneOf/anyOf/allOf) have no visual representation; keep
  // the original subtree intact so a visual-mode save never corrupts it. Only
  // the description is editable here; everything else lives in Code view.
  if (f.construct) {
    if (f.description) out.description = f.description
    else delete out.description
    return out
  }
  if (f.kind === 'media') {
    out.type = 'string'
    out[MediaField.TypeKeyword] = MediaField.MediaType
    delete out.enum
    delete out.$ref
    delete out.items
  } else if (f.kind === 'ref') {
    delete out.type
    delete out.enum
    delete out[MediaField.TypeKeyword]
    delete out.items
    // An empty target keeps the property valid (permissive) until one is picked.
    if (f.refTarget) out.$ref = f.refTarget
    else delete out.$ref
  } else if (f.kind === 'ref-array') {
    out.type = 'array'
    delete out.enum
    delete out.$ref
    delete out[MediaField.TypeKeyword]
    // An empty target keeps the property permissive until one is picked.
    if (f.refTarget) out.items = { $ref: f.refTarget }
    else delete out.items
  } else if (f.kind === 'enum') {
    out.type = 'string'
    out.enum = f.enumValues
    delete out.$ref
    delete out.items
    delete out[MediaField.TypeKeyword]
  } else {
    out.type = f.kind
    delete out.enum
    delete out.$ref
    delete out.items
    delete out[MediaField.TypeKeyword]
  }
  if (f.description) out.description = f.description
  else delete out.description
  return out
}

function buildSchema(base: any, fields: Field[], auth: boolean): string {
  const properties: any = {}
  const required: string[] = []
  for (const f of fields) {
    const name = f.name.trim()
    if (!name) continue
    properties[name] = fieldToProp(f)
    if (f.required) required.push(name)
  }
  const doc: any = { ...base }
  doc.$schema = base.$schema || 'https://json-schema.org/draft/2020-12/schema'
  doc.type = 'object'
  doc.properties = properties
  if (required.length) doc.required = required
  else delete doc.required
  SchemaAccess.setRequiresAuth(doc, auth)
  return JSON.stringify(doc, null, 2)
}

interface Props {
  collection: Collection | null
  collections: Collection[]
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  session: string
  /** URL to return to on cancel — the breadcrumbs link back to it. */
  backTo: string
  onLock: () => void
  onGoToServers?: () => void
  onSaved: (name: string) => void
  onCancel: () => void
}

export function SchemaEditorView({ collection, collections, url, apiKey, scope, claims, session, backTo, onLock, onGoToServers, onSaved, onCancel }: Props) {
  const initial = useMemo(() => {
    const text = collection ? JSON.stringify(collection.schema, null, 2) : JSON.stringify(DEFAULT_SCHEMA, null, 2)
    return { text, ...parseSchema(text) }
  }, [collection])

  const [name, setName] = useState(collection?.name || '')
  const [mode, setMode] = useState<'visual' | 'code'>('visual')
  const [text, setText] = useState(initial.text)
  const [base, setBase] = useState<any>(initial.base)
  const [fields, setFields] = useState<Field[]>(initial.fields)
  const [auth, setAuth] = useState(initial.auth)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const parsed = useMemo(() => parseSchema(text), [text])
  const fieldCount = mode === 'visual' ? fields.filter((f) => f.name.trim()).length : Object.keys(parsed.base?.properties || {}).length
  const canChangeAccess = !collection || Claims.has(
    claims,
    Claims.collection(scope.project, scope.env, collection.name, Claims.CollectionAccessUpdate),
  )

  const applyFields = (next: Field[]) => {
    setFields(next)
    setText(buildSchema(base, next, auth))
  }
  const setAuthFlag = (v: boolean) => {
    setAuth(v)
    if (mode === 'visual') setText(buildSchema(base, fields, v))
    else {
      try {
        const doc = JSON.parse(text)
        SchemaAccess.setRequiresAuth(doc, v)
        setText(JSON.stringify(doc, null, 2))
      } catch {
        /* leave invalid text for the user to fix */
      }
    }
  }

  const switchMode = (m: 'visual' | 'code') => {
    setError('')
    if (m === 'visual') {
      const p = parseSchema(text)
      if (!p.ok) {
        setError('Fix the JSON syntax before switching to the visual builder.')
        return
      }
      setBase(p.base)
      setFields(p.fields)
      setAuth(p.auth)
    }
    setMode(m)
  }

  const updateField = (i: number, patch: Partial<Field>) => {
    applyFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  }
  const addField = () => {
    const next = [...fields, { name: '', kind: 'string' as Kind, required: false, description: '', enumValues: [], refTarget: '', raw: {} }]
    applyFields(next)
    setSelected(next.length - 1)
  }
  const removeField = (i: number) => {
    applyFields(fields.filter((_, j) => j !== i))
    setSelected(null)
  }

  const save = async () => {
    setError('')
    const finalName = collection?.name || name.trim()
    if (!finalName) {
      setError('Collection name is required.')
      return
    }
    const toSave = mode === 'visual' ? buildSchema(base, fields, auth) : text
    let schema: any
    try {
      schema = JSON.parse(toSave)
    } catch {
      setError('Invalid JSON — cannot save.')
      return
    }
    setSaving(true)
    try {
      if (collection) await api.putSchema(url, apiKey, scope, finalName, schema)
      else await api.createCollection(url, apiKey, scope, finalName, schema)
      onSaved(finalName)
    } catch (e: any) {
      setError(e.message || 'Failed to save schema')
    } finally {
      setSaving(false)
    }
  }

  const valid = parsed.ok

  return (
    <>
      <TopBar
        crumbs={[{ label: 'Collections', to: backTo }, { label: collection ? collection.name : 'New collection' }]}
        session={session}
        onLock={onLock}
        onGoToServers={onGoToServers}
      />
      <div className="content">
        <div className={styles.layout}>
          <div className={`page-head ${styles.pageHeader}`}>
            <div className="page-title-group">
              <h2 className="page-title">{collection ? `Edit schema` : 'New collection'}</h2>
              <span className="page-sub">Define the collection with JSON Schema draft 2020-12.</span>
            </div>
            <div className="head-actions">
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>

      {!collection && (
        <div className={`field ${styles.nameField}`}>
          <label className="field-label">Collection name</label>
          <input
            className="input mono"
            placeholder="e.g. blog_posts"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          />
        </div>
      )}

      {error && (
        <div className="banner banner-bad">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div
        className={styles.authCard}
      >
        <div className={styles.authCopy}>
          <span className={styles.authTitle}>
            Private collection
          </span>
          <span className={styles.authDescription}>
            Require an API key to read entries (<span className="mono">{SchemaAccess.AuthKeyword}</span>).
          </span>
        </div>
        <Toggle size="sm" on={auth} onChange={setAuthFlag} disabled={!canChangeAccess} title={canChangeAccess ? undefined : 'Missing access:update claim'} />
      </div>

      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.name}>{collection?.name || name || 'untitled'}</span>
            <span className={styles.tag}>{mode === 'visual' ? 'schema' : 'schema.json'}</span>
          </div>
          <Segmented
            value={mode}
            variant="compact"
            onChange={switchMode}
            options={[
              { value: 'visual', label: <><List size={13} /> Visual</> },
              { value: 'code', label: <><Code2 size={13} /> Code</> },
            ]}
          />
        </div>

        {mode === 'visual' ? (
          <div className={styles.builder}>
            {fields.length === 0 && (
              <div className={styles.emptyFields}>
                No fields yet — add one below.
              </div>
            )}
            {fields.map((f, i) => (
              <div key={i}>
                <div className={`${styles.fieldRow} ${selected === i ? styles.selected : ''}`}>
                  <span className={styles.grip}>
                    <GripVertical size={15} />
                  </span>
                  <div className={styles.fieldSummary}>
                    <span className={styles.fieldName}>{f.name || <span className="muted">unnamed</span>}</span>
                    <span className={styles.fieldDescription}>
                      {f.construct
                        ? `${f.construct} · edit in Code view`
                        : f.kind === 'ref' || f.kind === 'ref-array'
                          ? SiloRef.isLocal(f.refTarget)
                            ? `${f.kind === 'ref-array' ? 'List of' : 'References'} collection · ${SiloRef.collectionOf(f.refTarget)}`
                            : f.refTarget
                              ? `${f.kind === 'ref-array' ? 'List of' : 'References'} remote schema · ${f.refTarget}`
                              : `${f.kind === 'ref-array' ? 'Reference list' : 'Reference'} · no target yet`
                          : f.kind === 'enum' && f.enumValues.length
                            ? `Enum · ${f.enumValues.join(', ')}`
                            : f.description || KIND_LABEL[f.kind]}
                    </span>
                  </div>
                  <span className={styles.type}>{f.construct || KIND_LABEL[f.kind]}</span>
                  <span className={`${styles.requirement} ${f.required ? styles.required : styles.optional}`}>{f.required ? 'required' : 'optional'}</span>
                  <button className={styles.gear} onClick={() => setSelected(selected === i ? null : i)}>
                    <Settings size={15} />
                  </button>
                </div>
                {selected === i && (
                  <div className={styles.fieldEditor}>
                    <div className={styles.fieldEditorRow}>
                      <div className={styles.fieldEditorColumn}>
                        <span className={styles.fieldEditorLabel}>Field name</span>
                        <input
                          className={`input mono ${styles.compactInput}`}
                          value={f.name}
                          onChange={(e) => updateField(i, { name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                        />
                      </div>
                      <div className={styles.fieldEditorColumn}>
                        <span className={styles.fieldEditorLabel}>Type</span>
                        {f.construct ? (
                          <div className={`input ${styles.compactInput} ${styles.constructInput}`}>
                            <span className="mono">{f.construct}</span>
                          </div>
                        ) : (
                          <select
                            className={`input ${styles.compactInput}`}
                            value={f.kind}
                            onChange={(e) => updateField(i, { kind: e.target.value as Kind })}
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="integer">Integer</option>
                            <option value="boolean">Boolean</option>
                            <option value="array">Array</option>
                            <option value="object">Object</option>
                            <option value="enum">Enum</option>
                            <option value="ref">Reference</option>
                            <option value="ref-array">Reference list</option>
                            <option value="media">Media</option>
                          </select>
                        )}
                      </div>
                    </div>

                    {f.kind === 'enum' && (
                      <div className={styles.fieldEditorColumn}>
                        <span className={styles.fieldEditorLabel}>Allowed values</span>
                        <EnumValues
                          values={f.enumValues}
                          onChange={(vals) => updateField(i, { enumValues: vals })}
                        />
                      </div>
                    )}

                    {(f.kind === 'ref' || f.kind === 'ref-array') && (
                      <RefTarget
                        target={f.refTarget}
                        collections={collections}
                        isArray={f.kind === 'ref-array'}
                        onChange={(refTarget) => updateField(i, { refTarget })}
                      />
                    )}

                    <div className={styles.fieldEditorColumn}>
                      <span className={styles.fieldEditorLabel}>Description</span>
                      <input
                        className={`input ${styles.compactInput}`}
                        placeholder="Optional help text"
                        value={f.description}
                        onChange={(e) => updateField(i, { description: e.target.value })}
                      />
                    </div>

                    <div className={styles.toggleRow}>
                      <span>Required field</span>
                      <Toggle size="sm" on={f.required} onChange={(v) => updateField(i, { required: v })} />
                    </div>
                    <Button
                      className={styles.removeField}
                      variant="dangerGhost"
                      size="sm"
                      onClick={() => removeField(i)}
                    >
                      <Trash2 size={13} /> Remove field
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <Button variant="dashed" onClick={addField}>
              <Plus size={15} /> Add field
            </Button>
          </div>
        ) : (
          <div className={styles.codeEditor}>
            <CodeMirror
              value={text}
              height="420px"
              theme="dark"
              extensions={[jsonLang()]}
              onChange={(v) => setText(v)}
            />
          </div>
        )}

        <div className={styles.footer}>
          <span className={`${styles.validity} ${valid ? '' : styles.invalid}`}>
            {valid ? <Check size={14} /> : <AlertCircle size={14} />}
            {valid ? `Schema is valid · ${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}` : 'Invalid JSON'}
          </span>
          <Button variant="primary" onClick={save} disabled={saving || !valid}>
            {saving ? 'Saving…' : 'Save schema'}
          </Button>
        </div>
      </div>
        </div>
      </div>
    </>
  )
}
