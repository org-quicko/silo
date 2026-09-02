import { SchemaAccess } from '@silo/shared/schema-access'
import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json as jsonLang } from '@codemirror/lang-json'
import { Check, AlertCircle, List, Code2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import type { Collection } from '../../api/types/collection'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Routes } from '../../router/routes'
import { Toggle } from '../../components/controls/Toggle'
import { Segmented } from '../../components/controls/Segmented'
import { DangerConfirm } from '../../components/modal/DangerConfirm'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import { RenameForm } from '../settings/rename/RenameForm'
import { CollectionRail } from './CollectionRail'
import { FieldList } from './FieldList'
import styles from './SchemaEditor.module.css'
import { useSchemaDraft, type SchemaEditorMode } from './use-schema-draft'

interface Props {
  serverId: string
  collection: Collection | null
  collections: Collection[]
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  /** URL to return to on cancel — the breadcrumbs link back to it. */
  backTo: string
  entryCount: number | null
  onSaved: (name: string) => void
  onCancel: () => void
  onDeleted: () => void
}

export function SchemaEditorView({
  serverId,
  collection,
  collections,
  url,
  apiKey,
  scope,
  claims,
  backTo: _backTo,
  entryCount,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  const draft = useSchemaDraft(collection)

  const [name, setName] = useState(collection?.name || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const canChangeAccess =
    !collection ||
    Claims.has(
      claims,
      Claims.collection(scope.project, scope.env, collection.name, Claims.CollectionAccessUpdate),
    )
  // The delete below always passes `force`, so the button asks for what force
  // costs (D37): the definition *and* the entries under it. Gating on
  // `collection:delete` alone offered a button the route now refuses.
  const canDelete =
    !!collection &&
    Claims.ForcedDeletePermissions.every((permission) =>
      Claims.has(
        claims,
        Claims.collection(scope.project, scope.env, collection.name, permission),
      ),
    )

  // A create at the new name and a delete at the old, on this collection (D51).
  // The route additionally asks for `schema:update` on every collection whose
  // schema `$ref`s this one, which is not knowable here — so that refusal
  // arrives from the server and the form prints it.
  const canRename =
    !!collection &&
    Claims.RenamePermissions.every((permission) =>
      Claims.has(
        claims,
        Claims.collection(scope.project, scope.env, collection.name, permission),
      ),
    )

  const switchMode = (next: SchemaEditorMode) => {
    setError('')
    if (!draft.switchMode(next)) {
      setError('Fix the JSON syntax before switching to the visual builder.')
    }
  }


  const save = async () => {
    setError('')
    const finalName = collection?.name || name.trim()
    if (!finalName) {
      setError('Collection name is required.')
      return
    }
    const toSave = draft.toSave()
    let schema: any
    try {
      schema = JSON.parse(toSave)
    } catch {
      setError('Invalid JSON — cannot save.')
      return
    }
    setSaving(true)
    try {
      if (collection) await api.collections.putSchema(url, apiKey, scope, finalName, schema)
      else await api.collections.create(url, apiKey, scope, finalName, schema)
      onSaved(finalName)
    } catch (caught: any) {
      setError(caught.message || 'Failed to save schema')
    } finally {
      setSaving(false)
    }
  }

  const removeCollection = async () => {
    if (!collection) return
    setDeleting(true)
    setDeleteError('')
    try {
      // The confirmation explicitly covers the schema and every entry, so the
      // destructive action is the force-delete variant rather than a button
      // that only happens to work for empty, unreferenced collections.
      await api.collections.delete(url, apiKey, scope, collection.name, true)
      setShowDelete(false)
      onDeleted()
    } catch (caught: any) {
      setDeleteError(caught.message || 'Failed to delete collection')
      setDeleting(false)
    }
  }

  const valid = draft.parsed.ok

  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            url={url}
            apiKey={apiKey}
            scope={scope}
            claims={claims}
            collections={collections.map((c) => ({ name: c.name, count: null, schema: c.schema }))}
          />
        }
      />
      <div className={`content ${styles.content}`}>
        <div className={styles.shell}>
          <div className={styles.main}>
            <div className={styles.layout}>
              {/* Crumbs and heading are one block, so the column's gap falls after
                  the pair and the heading lands exactly where the entries list
                  puts the collection name. A title that moves between pages reads
                  as the page jumping. */}
              <div>
                <Breadcrumb
                  crumbs={
                    collection
                      ? [
                          { label: 'Collections', to: Routes.collections(serverId, scope.project, scope.env) },
                          { label: collection.name },
                        ]
                      : [
                          { label: 'Collections', to: Routes.collections(serverId, scope.project, scope.env) },
                          { label: 'New collection' },
                        ]
                  }
                />
                <div className={`page-head ${styles.pageHeader}`}>
                  <div className="page-title-group">
                    <h2 className="page-title">{collection ? 'Edit collection' : 'New collection'}</h2>
                    <span className="page-sub">Define the collection with JSON Schema draft 2020-12.</span>
                  </div>
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

      {/*
        A rename here rather than beside the schema fields: it is a statement
        about the collection's identity, not about its shape, and it rewrites
        every `$ref` pointing at it (D51). Save is unaffected — the two are
        separate requests and neither carries the other's changes.
      */}
      {collection && (
        <div className={`field ${styles.nameField}`}>
          <label className="field-label">Collection name</label>
          <RenameForm
            subject={{ noun: 'collection', currentName: collection.name, id: collection.id }}
            allowed={canRename}
            unavailableReason={`This key cannot rename ${collection.name}. A rename retires the old name and introduces a new one, and repoints every schema that references it.`}
            rename={(next, dryRun) =>
              api.collections.rename(
                url,
                apiKey,
                scope,
                collection.name,
                next,
                collection.id,
                dryRun,
              )
            }
            onRenamed={onSaved}
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
        <Toggle size="sm" on={draft.requiresAuth} onChange={draft.setRequiresAuth} disabled={!canChangeAccess} title={canChangeAccess ? undefined : 'Missing access:update claim'} />
      </div>

      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.name}>{collection?.name || name || 'untitled'}</span>
            <span className={styles.tag}>{draft.mode === 'visual' ? 'schema' : 'schema.json'}</span>
          </div>
          <Segmented
            value={draft.mode}
            variant="compact"
            onChange={switchMode}
            options={[
              { value: 'visual', label: <><List size={13} /> Visual</> },
              { value: 'code', label: <><Code2 size={13} /> Code</> },
            ]}
          />
        </div>

        {draft.mode === 'visual' ? (
          <FieldList
            fields={draft.fields}
            collections={collections}
            expanded={draft.expanded}
            onExpand={draft.setExpanded}
            onChangeField={draft.updateField}
            onMoveField={draft.moveField}
            onRemoveField={draft.removeField}
            onAddField={draft.addField}
          />
        ) : (
          <div className={styles.codeEditor}>
            <CodeMirror
              value={draft.text}
              height="420px"
              theme="dark"
              extensions={[jsonLang()]}
              onChange={(value) => draft.setText(value)}
            />
          </div>
        )}

        <div className={styles.footer}>
          <span className={`${styles.validity} ${valid ? '' : styles.invalid}`}>
            {valid ? <Check size={14} /> : <AlertCircle size={14} />}
            {valid ? `Schema is valid · ${draft.fieldCount} ${draft.fieldCount === 1 ? 'field' : 'fields'}` : 'Invalid JSON'}
          </span>
        </div>
      </div>
            </div>
          </div>

          <CollectionRail
            collection={collection}
            scope={scope}
            fieldCount={draft.fieldCount}
            entryCount={entryCount}
            requiresAuth={draft.requiresAuth}
            canDelete={canDelete}
            onDelete={() => {
              setDeleteError('')
              setShowDelete(true)
            }}
            actions={
              <>
                <Button variant="primary" onClick={save} disabled={saving || !valid}>
                  {saving ? 'Saving…' : collection ? 'Save schema' : 'Create collection'}
                </Button>
                <Button variant="secondary" onClick={onCancel}>
                  Cancel
                </Button>
              </>
            }
          />
        </div>
      </div>

      {showDelete && collection && (
        <DangerConfirm
          title="Delete this collection?"
          confirmWord={collection.name}
          confirmLabel="Delete collection"
          busy={deleting}
          error={deleteError}
          onConfirm={removeCollection}
          onCancel={() => setShowDelete(false)}
        >
          The <b>{collection.name}</b> schema and{' '}
          {entryCount == null
            ? 'all of its entries'
            : entryCount === 1
              ? 'its 1 entry'
              : `all ${entryCount} of its entries`}{' '}
          are deleted permanently. References from other collection schemas are not removed.
        </DangerConfirm>
      )}
    </>
  )
}
