import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { useEffect, useMemo, useRef, useState } from 'react'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { ValidationDetail } from '@silo/shared/validation-detail'
import { api } from '../../api/silo-api'
import { ApiError } from '../../api/api-error'
import { Formatters } from '../../utils/formatters'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { ModalSubject } from '../../components/modal/ModalSubject'
import { slateTemplates, slateWidgets, slateFields } from '../../forms/theme'
import { buildUiSchema } from '../../forms/build-ui-schema'
import { MediaValue } from '../../forms/widgets/media-value'
import { SiloRefs } from '../../schema/silo-refs'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import styles from './EntryForm.module.css'

// Convert server ValidationDetails (JSON Pointer paths) into RJSF extraErrors.
function toExtraErrors(details?: ValidationDetail[]): any {
  const root: any = {}
  for (const d of details || []) {
    const parts = d.path.split('/').filter(Boolean)
    let node = root
    if (parts.length === 0) {
      node.__errors = [...(node.__errors || []), d.message]
      continue
    }
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i]
      node[key] = node[key] || {}
      node = node[key]
    }
    node.__errors = [...(node.__errors || []), d.message]
  }
  return root
}

interface Props {
  serverId: string
  collection: Collection
  collections: Collection[]
  url: string
  entry: Entry | null
  apiKey: string
  scope: ScopeRef
  claims: string[]
  /** URL of the collection's entry list — the breadcrumbs link back to it. */
  backTo: string
  onSaved: () => void
  onCancel: () => void
  onDeleted: () => void
}

export function EntryForm({
  serverId,
  collection,
  collections,
  url,
  entry,
  apiKey,
  scope,
  claims,
  backTo,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  // SiloRefs inlines silo://collections/* refs as internal pointers (RJSF and
  // its ajv8 validator only follow #/... pointers) and strips $schema, which
  // the draft-07 ajv8 meta-schema would trip over. The server remains the
  // authoritative validator (full 2020-12, remote refs if enabled).
  const schema = useMemo(() => SiloRefs.resolveForForm(collection.name, collection.schema, collections), [collection, collections])
  const uiSchema = useMemo(() => buildUiSchema(schema), [schema])
  const initial = useMemo(() => entry?.data ?? {}, [entry])

  const [formData, setFormData] = useState<any>(initial)
  const [extraErrors, setExtraErrors] = useState<any>(undefined)
  const [formError, setFormError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const formRef = useRef<any>(null)
  // RJSF injects schema defaults via an onChange right after mount; capture that
  // as the "clean" baseline so a fresh form isn't reported dirty on load.
  const mountedRef = useRef(false)
  const baselineRef = useRef(JSON.stringify(initial))
  useEffect(() => {
    const id = setTimeout(() => {
      mountedRef.current = true
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const canSave = Claims.has(
    claims,
    Claims.collection(
      scope.project,
      scope.env,
      collection.name,
      entry ? Claims.CollectionEntriesUpdate : Claims.CollectionEntriesCreate,
    ),
  )
  const canDelete = !!entry && Claims.has(
    claims,
    Claims.collection(scope.project, scope.env, collection.name, Claims.CollectionEntriesDelete),
  )

  const handleSubmit = async ({ formData: rawData }: any) => {
    setSaving(true)
    setFormError('')
    setExtraErrors(undefined)
    // A media field that reads back `null` (D48: its asset was force-deleted)
    // is omitted here rather than sent as `null` — the media schema rejects
    // `null` outright, which would fail the save on a field nobody touched.
    const data = MediaValue.omitUnresolved(rawData, schema)
    try {
      if (entry) await api.entries.update(url, apiKey, scope, collection.name, entry.id, entry.rev, data)
      else await api.entries.create(url, apiKey, scope, collection.name, data)
      onSaved()
    } catch (caught: any) {
      if (caught instanceof ApiError && caught.details && caught.details.length) {
        setExtraErrors(toExtraErrors(caught.details))
        setFormError('')
      } else {
        setFormError(caught.message || 'Failed to save entry')
      }
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!entry) return
    try {
      await api.entries.delete(url, apiKey, scope, collection.name, entry.id, entry.rev)
      setShowDelete(false)
      onDeleted()
    } catch (caught: any) {
      alert(caught.message || 'Delete failed')
    }
  }

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
      >
        {dirty && (
          <span className={styles.unsaved}>
            <span className={styles.unsavedDot} /> Unsaved changes
          </span>
        )}
        <Button variant="secondary" onClick={onCancel}>
          Discard
        </Button>
        {canSave && (
          <Button variant="primary" onClick={() => formRef.current?.submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save entry'}
          </Button>
        )}
      </TopBar>

      <div className={`content ${styles.content}`}>
        <Breadcrumb
          crumbs={[
            { label: 'Collections', to: backTo },
            { label: collection.name, to: backTo },
            { label: entry ? 'Edit entry' : 'New entry' },
          ]}
        />
        <div className={styles.shell}>
          <div className={styles.main}>
            {formError && (
              <div className="banner banner-bad">
                <span>{formError}</span>
              </div>
            )}
            <Form
              ref={formRef}
              schema={schema}
              uiSchema={uiSchema}
              validator={validator}
              formData={formData}
              templates={slateTemplates as any}
              widgets={slateWidgets as any}
              fields={slateFields as any}
              extraErrors={extraErrors}
              showErrorList="top"
              disabled={!canSave}
              formContext={{ url, apiKey }}
              onChange={(e: any) => {
                const s = JSON.stringify(e.formData)
                setFormData(e.formData)
                // Pre-interaction emits (default injection) reset the baseline.
                if (!mountedRef.current) {
                  baselineRef.current = s
                  setDirty(false)
                  return
                }
                setDirty(s !== baselineRef.current)
              }}
              onSubmit={handleSubmit}
            >
              <></>
            </Form>
          </div>

          <div className={styles.rail}>
            {entry ? (
              <div className={styles.group}>
                <span className={styles.label}>SYSTEM</span>
                <div className={styles.row}>
                  <span className={styles.key}>id</span>
                  <span className={styles.value} title={entry.id}>
                    {Formatters.shortId(entry.id)}
                  </span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>created</span>
                  <span className={styles.value}>{Formatters.shortDate(entry.created_at)}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>updated</span>
                  <span className={styles.value}>{Formatters.relativeTime(entry.updated_at)}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>revision</span>
                  <span className={styles.value}>v{entry.rev}</span>
                </div>
              </div>
            ) : (
              <div className={styles.group}>
                <span className={styles.label}>NEW ENTRY</span>
                <p className={`${styles.caption} ${styles.captionLeft}`}>
                  Fields are generated from the <b>{collection.name}</b> schema. silo validates on save; the id,
                  revision, and timestamps are assigned automatically.
                </p>
              </div>
            )}

            {entry && canDelete && (
              <>
                <div className={styles.divider} />
                <Button variant="dangerGhost" onClick={() => setShowDelete(true)}>
                  <Trash2 size={14} /> Delete entry
                </Button>
                <span className={styles.caption}>
                  Deleting removes the row and bumps the collection revision. This can't be undone.
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {showDelete && entry && (
        <Modal onClose={() => setShowDelete(false)}>
          <ModalHeader>
            <ModalIcon tone="bad">
              <Trash2 size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Delete this entry?</h3>
              <ModalBody>
                You're about to delete this entry from <b>{collection.name}</b>. The row is removed immediately and
                can't be recovered.
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <ModalSubject
            mark={collection.name.charAt(0).toUpperCase()}
            title={Formatters.shortId(entry.id)}
            subtitle={`rev v${entry.rev}`}
          />
          <ModalActions>
            <Button variant="secondary" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete}>
              Delete entry
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
