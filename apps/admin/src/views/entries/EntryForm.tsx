import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { AlertTriangle, Code2, List, Trash2 } from 'lucide-react'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SessionInfo } from '../../api/types/session-info'
import { Button } from '../../components/buttons/Button'
import { Segmented } from '../../components/controls/Segmented'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalError } from '../../components/modal/ModalError'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { ModalSubject } from '../../components/modal/ModalSubject'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { slateFields, slateTemplates, slateWidgets } from '../../forms/theme'
import { Routes } from '../../router/routes'
import { Formatters } from '../../utils/formatters'
import { DiscardChangesModal } from '../DiscardChangesModal'
import { SmartSearch } from '../search/SmartSearch'
import { TopBar } from '../shell/TopBar'
import { TrashCopy } from '../trash/trash-copy'
import { EntryJsonEditor } from './EntryJsonEditor'
import { EntrySystemRail } from './EntrySystemRail'
import { ReloadRevisionModal } from './ReloadRevisionModal'
import { useEntryForm } from './use-entry-form'
import styles from './EntryForm.module.css'

interface Props {
  serverId: string
  collection: Collection
  /** Names and counts, for the search bar in the top chrome. The schema this
   *  form renders is self-contained (D54), so no other collection is fetched. */
  collections: readonly { name: string; count: number | null }[]
  url: string
  entry: Entry | null
  apiKey: string
  scope: ScopeRef
  claims: string[]
  /** URL of the collection's entry list — the breadcrumbs link back to it. */
  backTo: string
  /** Optional history state passed when navigating back via the collection breadcrumb. */
  backState?: Record<string, unknown>
  /** Unconditional cache/count invalidation callback when create/update/delete succeeds. */
  onMutated?: () => void
  onSaved: (isCurrent: () => boolean) => void
  onCancel: () => void
  /** Read for whether this delete is recoverable, which is an instance
   *  setting rather than something the form can assume (D113). */
  session: SessionInfo | null
  onDeleted: (isCurrent: () => boolean) => void
  /** Called when the undo toast puts the entry back. The form has navigated
   *  away by then, so the list it returned to is what needs refreshing. */
  onRestored: () => void
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
  backState,
  onMutated,
  onSaved,
  onCancel,
  session,
  onDeleted,
  onRestored,
}: Props) {
  const form = useEntryForm({
    serverId,
    collection,
    url,
    entry,
    apiKey,
    scope,
    claims,
    onMutated,
    onSaved,
    onCancel,
    onDeleted,
    onRestored,
  })

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
            <div>
              <Breadcrumb
                crumbs={[
                  { label: 'Collections', to: Routes.collections(serverId, scope.project, scope.env) },
                  { label: collection.name, to: backTo, state: backState },
                  { label: entry ? entry.id : 'New entry' },
                ]}
              />
              <div className={`page-head ${styles.pageHead}`}>
                <div className="page-title-group">
                  <h2 className="page-title">{entry ? 'Edit entry' : 'New entry'}</h2>
                </div>
                <Segmented
                  value={form.editorMode}
                  variant="compact"
                  disabled={form.saving || form.mediaUploading}
                  onChange={form.switchMode}
                  options={[
                    { value: 'form', label: <><List size={13} /> Form</> },
                    { value: 'json', label: <><Code2 size={13} /> JSON</> },
                  ]}
                />
              </div>
            </div>

            {form.stale && entry && form.baseline.rev !== null && (
              <div className={`banner banner-warn ${styles.staleBanner}`} role="alert">
                <span className={styles.staleMessage}>
                  <AlertTriangle size={16} />
                  <span>
                    Revision {entry.rev} is available. You're editing revision {form.baseline.rev} — review or reload
                    before saving
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={form.saving}
                  className={styles.bannerAction}
                  onClick={() => form.setShowReloadConfirm(true)}
                >
                  Reload
                </Button>
              </div>
            )}

            {form.formError && (
              <div className="banner banner-bad" role="alert">
                <span>{form.formError}</span>
              </div>
            )}

            {form.editorMode === 'form' ? (
              <Form
                key={form.formSession}
                ref={form.formRef}
                schema={form.schema}
                uiSchema={form.uiSchema}
                validator={validator}
                formData={form.formData}
                templates={slateTemplates as any}
                widgets={slateWidgets as any}
                fields={slateFields as any}
                extraErrors={form.extraErrors}
                experimental_defaultFormStateBehavior={form.defaultFormStateBehavior}
                noHtml5Validate
                showErrorList="top"
                disabled={!form.canSave || form.saving}
                formContext={form.formContext}
                onChange={form.handleFormChange}
                onSubmit={form.handleFormSubmit}
              >
                <></>
              </Form>
            ) : (
              <EntryJsonEditor
                key={form.formSession}
                serverId={serverId}
                text={form.jsonText}
                validation={form.jsonValidation}
                disabled={!form.canSave || form.saving}
                editorRef={form.jsonEditorRef}
                onChange={form.handleJsonChange}
              />
            )}
          </div>

          <EntrySystemRail
            entry={entry}
            baselineRev={form.baseline.rev}
            collectionName={collection.name}
            session={session}
            dirty={form.dirty}
            saving={form.saving}
            saveDisabled={form.mediaUploading}
            canSave={form.canSave}
            canDelete={form.canDelete}
            onSave={form.submitEntry}
            onDiscard={form.discard}
            onDelete={() => {
              form.setDeleteError('')
              form.setShowDelete(true)
            }}
          />
        </div>
      </div>

      {form.guard.confirming && (
        <DiscardChangesModal
          onKeepEditing={form.guard.cancelDiscard}
          onDiscard={form.guard.confirmDiscard}
        />
      )}

      {form.showReloadConfirm && entry && form.baseline.rev !== null && (
        <ReloadRevisionModal
          latestRev={entry.rev}
          baselineRev={form.baseline.rev}
          onCancel={() => form.setShowReloadConfirm(false)}
          onConfirm={form.reloadLatest}
        />
      )}

      {form.showDelete && entry && (
        <Modal onClose={form.deleting ? () => {} : () => form.setShowDelete(false)}>
          <ModalHeader>
            <ModalIcon tone="bad">
              <Trash2 size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Delete this entry?</h3>
              <ModalBody>
                You're about to delete this entry from <b>{collection.name}</b>.{' '}
                {TrashCopy.reassurance(session)}
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <ModalSubject
            mark={collection.name.charAt(0).toUpperCase()}
            title={Formatters.shortId(entry.id)}
            subtitle={`rev v${form.baseline.rev ?? entry.rev}`}
          />
          {form.deleteError && <ModalError className={styles.deleteError}>{form.deleteError}</ModalError>}
          <ModalActions>
            <Button
              type="button"
              variant="secondary"
              disabled={form.deleting}
              onClick={() => form.setShowDelete(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={form.deleting} onClick={form.doDelete}>
              {form.deleting ? 'Deleting…' : TrashCopy.enabled(session) ? 'Move to trash' : 'Delete entry'}
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
