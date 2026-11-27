import { SchemaAccess } from '@silo/shared/schema-access'
import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json as jsonLang } from '@codemirror/lang-json'
import { Check, AlertCircle, List, Code2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { CollectionName } from '@silo/shared/collection-name'
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
import { DiscardChangesModal } from '../DiscardChangesModal'
import { useDirtyGuard } from '../use-dirty-guard'
import { useEscapeToDiscard } from '../use-escape-to-discard'
import { useSaveShortcut } from '../use-save-shortcut'
import { useThemeMode } from '../../utils/use-theme-mode'
import { CollectionNameMessage } from './collection-name-message'
import { CollectionRail } from './CollectionRail'
import { FieldList } from './FieldList'
import { SchemaSaveGuard } from './schema-save-guard'
import styles from './SchemaEditor.module.css'
import { useSchemaDraft, type SchemaEditorMode } from './use-schema-draft'

interface Props {
  serverId: string
  collection: Collection | null
  /** Every collection in the scope, as ref targets and for the search bar.
   *  Names only — no ref target needs another collection's schema. */
  collections: readonly { name: string; count: number | null }[]
  url: string
  apiKey: string
  scope: ScopeRef
  claims: string[]
  /** URL to return to on cancel — the breadcrumbs link back to it. */
  backTo: string
  entryCount: number | null
  onMutationStart?: () => number | null
  onMutationEnd?: (mutationIdAtStart: number | null) => void
  onMutated?: (name: string) => void
  onSaved: (
    name: string,
    isCurrent: () => boolean,
    mutationIdAtStart?: number | null,
  ) => void | Promise<void>
  onCancel: () => void
  onDeletedMutated?: () => void
  onDeleted: (
    isCurrent: () => boolean,
    mutationIdAtStart?: number | null,
  ) => void | Promise<void>
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
  onMutationStart,
  onMutationEnd,
  onMutated,
  onSaved,
  onCancel,
  onDeletedMutated,
  onDeleted,
}: Props) {
  const draft = useSchemaDraft(collection)

  const [name, setName] = useState(collection?.name || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [saveGuard] = useState(() => new SchemaSaveGuard())
  const mode = useThemeMode(serverId)

  useEffect(() => {
    saveGuard.mount()
    return () => {
      saveGuard.unmount()
    }
  }, [saveGuard])

  const dirty = draft.isDirty(name)
  const dirtyRef = useRef(dirty)
  useLayoutEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const guard = useDirtyGuard(dirty)

  // Escape is Discard, unless the delete dialog or discard confirmation is up.
  useEscapeToDiscard(() => guard.requestDiscard(onCancel), !showDelete && !guard.confirming)

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
    if (saveGuard.isSaving() || saveGuard.isDeleting()) return
    setError('')
    const finalName = collection?.name || name.trim()
    if (!finalName) {
      setError('Collection name is required.')
      return
    }
    const nameProblem = collection ? null : CollectionNameMessage.of(finalName)
    if (nameProblem) {
      setError(nameProblem)
      return
    }
    const toSave = draft.toSave()
    let schema: any
    try {
      schema = JSON.parse(toSave)
    } catch {
      setError('The JSON is not valid, so it cannot be saved.')
      return
    }
    await saveGuard.runSave({
      persist: async () => {
        if (collection) await api.collections.putSchema(url, apiKey, scope, finalName, schema)
        else await api.collections.create(url, apiKey, scope, finalName, schema)
        onMutated?.(finalName)
      },
      onSuccess: (isCurrent) => {
        guard.disarm()
        return onSaved(finalName, isCurrent)
      },
      onStateChange: setSaving,
      onError: (caught) => {
        setError(caught instanceof Error && caught.message ? caught.message : 'Failed to save schema')
      },
    })
  }

  const removeCollection = async () => {
    if (!collection || saveGuard.isDeleting() || saveGuard.isSaving()) return
    setDeleteError('')
    let mutationIdAtStart: number | null = null
    try {
      await saveGuard.runDelete({
        remove: async () => {
          mutationIdAtStart = onMutationStart?.() ?? null
          // The confirmation explicitly covers the schema and every entry, so the
          // destructive action is the force-delete variant rather than a button
          // that only happens to work for empty, unreferenced collections.
          await api.collections.delete(url, apiKey, scope, collection.name, true)
          onDeletedMutated?.()
        },
        onSuccess: (isCurrent) => {
          setShowDelete(false)
          guard.disarm()
          return onDeleted(isCurrent, mutationIdAtStart)
        },
        onStateChange: setDeleting,
        onError: (caught) => {
          setDeleteError(
            caught instanceof Error && caught.message ? caught.message : 'Failed to delete collection',
          )
        },
      })
    } finally {
      onMutationEnd?.(mutationIdAtStart)
    }
  }

  const valid = draft.parsed.ok
  useSaveShortcut(save, !saving && valid)

  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            url={url}
            apiKey={apiKey}
            scope={scope}
            collections={collections}
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
            disabled={saving}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          />
          {CollectionNameMessage.of(name) ? (
            <span className="field-error">{CollectionNameMessage.of(name)}</span>
          ) : (
            <span className="field-hint">
              Up to {CollectionName.MaxLength} characters. Start with a lowercase letter.
            </span>
          )}
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
            allowed={canRename && !dirty && !saving && !deleting}
            canCommit={() => canRename && !dirtyRef.current}
            unavailableReason={
              dirty
                ? 'Save or discard your unsaved schema changes before renaming this collection.'
                : saving
                  ? 'Saving schema changes…'
                  : `This key cannot rename ${collection.name}. A rename retires the old name and introduces a new one, and repoints every schema that references it.`
            }
            rename={async (next, dryRun) => {
              if (!dryRun && dirtyRef.current) {
                throw new Error(
                  'Save or discard your unsaved schema changes before renaming this collection.',
                )
              }
              const result = await api.collections.rename(
                url,
                apiKey,
                scope,
                collection.name,
                next,
                collection.id,
                dryRun,
              )
              if (!dryRun) onMutated?.(next)
              return result
            }}
            runCommit={(commit) =>
              saveGuard
                .runCommit({
                  run: async (isCurrent) => {
                    if (!canRename || dirtyRef.current) {
                      await commit(isCurrent, null)
                      return
                    }
                    const mutationIdAtStart = onMutationStart?.() ?? null
                    try {
                      await commit(isCurrent, mutationIdAtStart)
                    } finally {
                      onMutationEnd?.(mutationIdAtStart)
                    }
                  },
                  onStateChange: setSaving,
                })
                .then(() => undefined)
            }
            onRenamed={(nextName, isCurrent, mutationIdAtStart) => {
              guard.disarm()
              return onSaved(nextName, isCurrent ?? (() => true), mutationIdAtStart)
            }}
            validate={CollectionNameMessage.of}
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
        <Toggle
          size="sm"
          on={draft.requiresAuth}
          onChange={draft.setRequiresAuth}
          disabled={!canChangeAccess || saving}
          title={canChangeAccess ? undefined : 'Missing access:update claim'}
        />
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
            disabled={saving}
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
            disabled={saving}
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
              theme={mode}
              editable={!saving}
              readOnly={saving}
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
            dirty={dirty}
            saving={saving}
            canDelete={canDelete}
            onDelete={() => {
              if (saving) return
              setDeleteError('')
              setShowDelete(true)
            }}
            actions={
              <>
                <Button variant="primary" onClick={save} disabled={saving || !valid}>
                  {saving ? 'Saving…' : collection ? 'Save schema' : 'Create collection'}
                </Button>
                <Button variant="secondary" disabled={saving} onClick={() => guard.requestDiscard(onCancel)}>
                  Cancel
                </Button>
              </>
            }
          />
        </div>
      </div>

      {guard.confirming && (
        <DiscardChangesModal
          onKeepEditing={guard.cancelDiscard}
          onDiscard={guard.confirmDiscard}
        />
      )}

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
