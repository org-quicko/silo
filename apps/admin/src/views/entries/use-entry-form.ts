import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import { ApiError, ValidationFailedError } from '../../api/api-error'
import type { Collection } from '../../api/types/collection'
import type { Entry } from '../../api/types/entry'
import type { ScopeRef } from '../../api/types/scope-ref'
import { buildUiSchema } from '../../forms/build-ui-schema'
import { FormSchema } from '../../forms/form-schema'
import { MediaValue } from '../../forms/widgets/media-value'
import { Routes } from '../../router/routes'
import { SiloRefs } from '../../schema/silo-refs'
import { store } from '../../store/store'
import { StoreKeys } from '../../store/store-keys'
import { useVariables } from '../../store/use-variables'
import { ToastManager } from '../../utils/toast-manager'
import { TrashUndo } from '../trash/trash-undo'
import { useDirtyGuard } from '../use-dirty-guard'
import { useEscapeToDiscard } from '../use-escape-to-discard'
import { useSaveShortcut } from '../use-save-shortcut'
import { EntryBaseline, type EntryEditorMode } from './entry-baseline'
import { EntryJsonDocument } from './entry-json-document'
import { EntryJsonValidator } from './entry-json-validator'

export interface UseEntryFormOptions {
  serverId: string
  collection: Collection
  url: string
  entry: Entry | null
  apiKey: string
  scope: ScopeRef
  claims: string[]
  onMutated?: () => void
  onSaved: (isCurrent: () => boolean) => void
  onCancel: () => void
  onDeleted: (isCurrent: () => boolean) => void
  onRestored: () => void
}

const MEDIA_UPLOAD_WAIT_MESSAGE = 'Wait for the media upload to finish before saving.'

/**
 * Encapsulates `EntryForm` editing state: atomic `(data, rev)` baseline,
 * SWR adoption / stale revision tracking, Form/JSON mode switching, invalid
 * `JsonField` tracking, active media upload gating, `⌘S` submit, dirty
 * navigation guard, and delete flow.
 */
export function useEntryForm({
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
}: UseEntryFormOptions) {
  const schema = useMemo(
    () => FormSchema.forEntry(SiloRefs.resolveForForm(collection.name, collection.schema)),
    [collection],
  )
  const uiSchema = useMemo(() => buildUiSchema(schema), [schema])
  const entryJsonValidator = useMemo(
    () => new EntryJsonValidator(collection.name, collection.schema),
    [collection.name, collection.schema],
  )

  const { variables } = useVariables(serverId, url, apiKey, scope)
  const variableContext = useMemo(
    () => ({
      variables,
      env: scope.env,
      manageHref: Routes.envSettings(serverId, scope.project, scope.env, 'variables'),
    }),
    [variables, serverId, scope.project, scope.env],
  )

  const [editorMode, setEditorMode] = useState<EntryEditorMode>('form')
  const [baseline, setBaseline] = useState(() => EntryBaseline.create(entry))
  const [formData, setFormData] = useState<Record<string, any>>(() => baseline.data)
  const [jsonText, setJsonText] = useState(() => EntryJsonDocument.format(baseline.data))
  const [hasEditedJson, setHasEditedJson] = useState(false)
  const [invalidJsonKeys, setInvalidJsonKeys] = useState<Set<string>>(() => new Set())
  const [pendingMediaKeys, setPendingMediaKeys] = useState<Set<string>>(() => new Set())
  const [extraErrors, setExtraErrors] = useState<any>(undefined)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [showReloadConfirm, setShowReloadConfirm] = useState(false)
  const [formSession, setFormSession] = useState(0)

  const formRef = useRef<any>(null)
  const jsonEditorRef = useRef<{ focus: () => void } | null>(null)
  const invalidJsonFocusRef = useRef(new Map<string, () => void>())
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
  const settledRef = useRef(false)
  const settleTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const actionTokenRef = useRef(0)

  const scheduleSettle = useCallback(() => {
    settledRef.current = false
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      settledRef.current = true
    }, 0)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      actionTokenRef.current += 1
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    }
  }, [])

  useEffect(() => {
    invalidJsonFocusRef.current.clear()
    scheduleSettle()
  }, [formSession, scheduleSettle])

  const jsonValidation = useMemo(
    () => entryJsonValidator.validate(jsonText),
    [entryJsonValidator, jsonText],
  )
  const activeFormData =
    editorMode === 'json' && jsonValidation.data !== null ? jsonValidation.data : formData

  const dirty = EntryBaseline.isDirty({
    formData: activeFormData,
    baselineData: baseline.data,
    mode: editorMode,
    invalidJsonFieldCount: editorMode === 'form' ? invalidJsonKeys.size : 0,
    jsonUnrepresentable: editorMode === 'json' ? jsonValidation.unrepresentable : false,
  })
  const mediaUploading = pendingMediaKeys.size > 0

  if (
    entry !== null &&
    EntryBaseline.shouldAdoptServerEntry({
      entry,
      dirty,
      mediaUploading,
      baselineRev: baseline.rev,
      lastServerJson: baseline.serverJson,
    })
  ) {
    const nextBaseline = EntryBaseline.create(entry)
    setBaseline(nextBaseline)
    setFormData(nextBaseline.data)
    setJsonText(EntryJsonDocument.format(nextBaseline.data))
    setHasEditedJson(false)
    setInvalidJsonKeys(new Set())
    setPendingMediaKeys(new Set())
    setExtraErrors(undefined)
    setFormError('')
    setFormSession((value) => value + 1)
  }

  const resetToEntry = (nextEntry: Entry) => {
    const nextBaseline = EntryBaseline.create(nextEntry)
    setBaseline(nextBaseline)
    setFormData(nextBaseline.data)
    setJsonText(EntryJsonDocument.format(nextBaseline.data))
    setHasEditedJson(false)
    setInvalidJsonKeys(new Set())
    setPendingMediaKeys(new Set())
    setExtraErrors(undefined)
    setFormError('')
    setFormSession((value) => value + 1)
  }

  const stale = EntryBaseline.isStale(entry, baseline.rev)
  const guard = useDirtyGuard(dirty)

  useEscapeToDiscard(
    () => guard.requestDiscard(onCancel),
    !showDelete && !showReloadConfirm && !guard.confirming,
  )

  const canSave = Claims.has(
    claims,
    Claims.collection(
      scope.project,
      scope.env,
      collection.name,
      entry ? Claims.CollectionEntriesUpdate : Claims.CollectionEntriesCreate,
    ),
  )
  const canDelete =
    !!entry &&
    Claims.has(
      claims,
      Claims.collection(scope.project, scope.env, collection.name, Claims.CollectionEntriesDelete),
    )

  const onJsonValidityChange = useCallback(
    (fieldKey: string, invalid: boolean, focus?: () => void) => {
      if (invalid && focus) invalidJsonFocusRef.current.set(fieldKey, focus)
      else if (!invalid) invalidJsonFocusRef.current.delete(fieldKey)

      setInvalidJsonKeys((previous) => {
        const has = previous.has(fieldKey)
        if (invalid === has) return previous
        const next = new Set(previous)
        if (invalid) next.add(fieldKey)
        else next.delete(fieldKey)
        return next
      })
    },
    [],
  )

  const focusFirstInvalidJsonField = useCallback(() => {
    for (const key of invalidJsonKeys) {
      const focus = invalidJsonFocusRef.current.get(key)
      if (focus) {
        focus()
        return
      }
    }
    const fallback = invalidJsonFocusRef.current.values().next().value
    fallback?.()
  }, [invalidJsonKeys])

  const onMediaUploadPendingChange = useCallback((fieldKey: string, pending: boolean) => {
    setPendingMediaKeys((previous) => {
      const has = previous.has(fieldKey)
      if (pending === has) return previous
      const next = new Set(previous)
      if (pending) next.add(fieldKey)
      else next.delete(fieldKey)
      return next
    })
  }, [])

  const displayedFormError =
    !mediaUploading && formError === MEDIA_UPLOAD_WAIT_MESSAGE ? '' : formError

  const formContext = useMemo(
    () => ({
      serverId,
      url,
      apiKey,
      claims,
      variables: variableContext,
      onJsonValidityChange,
      onMediaUploadPendingChange,
    }),
    [serverId, url, apiKey, claims, variableContext, onJsonValidityChange, onMediaUploadPendingChange],
  )

  const defaultFormStateBehavior = useMemo(
    () => EntryBaseline.defaultFormStateBehavior(Boolean(entry), hasEditedJson),
    [entry, hasEditedJson],
  )

  const savePayload = async (payload: any, modeAtSubmit: EntryEditorMode) => {
    if (!canSave || savingRef.current) return
    const token = ++actionTokenRef.current
    const epochAtStart = store.sessionEpoch()
    savingRef.current = true
    setSaving(true)
    setFormError('')
    setExtraErrors(undefined)
    // Only omit unresolved media `null`s in Form mode so explicit `null`s
    // authored in raw JSON mode are preserved as written.
    const data = modeAtSubmit === 'form' ? MediaValue.omitUnresolved(payload, schema) : payload

    try {
      if (entry) {
        const revToSend = baseline.rev ?? entry.rev
        await api.entries.update(url, apiKey, scope, collection.name, entry.id, revToSend, data)
      } else {
        await api.entries.create(url, apiKey, scope, collection.name, data)
      }
      if (store.sessionEpoch() !== epochAtStart) return
      // Invalidate caches and collection counts unconditionally even if the
      // user navigated away while this slow request was in flight.
      onMutated?.()
      if (!mountedRef.current || actionTokenRef.current !== token) return
      guard.disarm()
      ToastManager.show(entry ? 'Entry updated' : 'Entry created')
      onSaved(() => mountedRef.current && actionTokenRef.current === token)
    } catch (caught: unknown) {
      if (store.sessionEpoch() !== epochAtStart || !mountedRef.current || actionTokenRef.current !== token) {
        return
      }
      if (EntryBaseline.isConflictError(caught)) {
        const message =
          caught instanceof Error && caught.message
            ? caught.message
            : 'This entry was modified elsewhere. Review or reload the latest revision before saving.'
        setFormError(message)
        if (entry) {
          void store.refresh(StoreKeys.entry(serverId, scope, collection.name, entry.id), () =>
            api.entries.get(url, apiKey, scope, collection.name, entry.id),
          )
        }
      } else if (
        (caught instanceof ValidationFailedError || caught instanceof ApiError) &&
        caught.details &&
        caught.details.length > 0
      ) {
        if (modeAtSubmit === 'form') {
          setExtraErrors(EntryBaseline.toExtraErrors(caught.details))
          setFormError('')
        } else {
          setExtraErrors(undefined)
          setFormError(EntryBaseline.formatValidationDetails(caught.details))
        }
      } else {
        setFormError(caught instanceof Error && caught.message ? caught.message : 'Failed to save entry')
      }
    } finally {
      if (mountedRef.current && actionTokenRef.current === token) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }

  const handleFormChange = (event: any) => {
    const nextData = event.formData ?? {}
    setFormData(nextData)
    if (!settledRef.current) {
      setBaseline((current) => ({ ...current, data: nextData }))
    }
  }

  const handleFormSubmit = ({ formData: rawData }: any) => {
    if (pendingMediaKeys.size > 0) {
      setFormError(MEDIA_UPLOAD_WAIT_MESSAGE)
      return
    }
    if (invalidJsonKeys.size > 0) {
      setFormError('Fix invalid JSON fields before saving.')
      focusFirstInvalidJsonField()
      return
    }
    void savePayload(rawData, 'form')
  }

  const submitEntry = () => {
    if (!canSave || savingRef.current) return
    if (pendingMediaKeys.size > 0) {
      setFormError(MEDIA_UPLOAD_WAIT_MESSAGE)
      return
    }
    if (editorMode === 'form') {
      if (invalidJsonKeys.size > 0) {
        setFormError('Fix invalid JSON fields before saving.')
        focusFirstInvalidJsonField()
        return
      }
      formRef.current?.submit()
      return
    }

    if (!jsonValidation.ok || jsonValidation.data === null) {
      setFormError(jsonValidation.error || 'Fix JSON validation errors before saving.')
      jsonEditorRef.current?.focus()
      return
    }
    void savePayload(jsonValidation.data, 'json')
  }

  useSaveShortcut(submitEntry, canSave && !saving && !mediaUploading)

  const switchMode = (next: EntryEditorMode) => {
    if (savingRef.current) return
    const plan = EntryBaseline.planModeSwitch({
      from: editorMode,
      to: next,
      mediaUploading: pendingMediaKeys.size > 0,
      invalidJsonFieldCount: invalidJsonKeys.size,
      jsonText,
      validation: editorMode === 'json' ? jsonValidation : undefined,
      canSave,
      formSchema: schema,
      uiSchema,
    })
    if (!plan.ok) {
      setFormError(plan.error)
      if (plan.target === 'jsonField') {
        focusFirstInvalidJsonField()
      } else if (plan.target === 'jsonEditor') {
        jsonEditorRef.current?.focus()
      }
      return
    }

    setFormError('')
    if (plan.action === 'noop') return
    if (plan.action === 'toJson') {
      setJsonText(EntryJsonDocument.format(formData))
      setEditorMode('json')
      return
    }

    setExtraErrors(undefined)
    setFormData(plan.data)
    if (!dirty) scheduleSettle()
    setEditorMode('form')
  }

  const handleJsonChange = (nextText: string) => {
    setHasEditedJson(true)
    setJsonText(nextText)
    if (formError) setFormError('')
  }

  const doDelete = async () => {
    if (!entry || deletingRef.current || savingRef.current) return
    const token = ++actionTokenRef.current
    const epochAtStart = store.sessionEpoch()
    deletingRef.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      const revToDelete = baseline.rev ?? entry.rev
      const trashId = await api.entries.delete(
        url,
        apiKey,
        scope,
        collection.name,
        entry.id,
        revToDelete,
      )
      if (store.sessionEpoch() !== epochAtStart) return
      onMutated?.()
      if (!mountedRef.current || actionTokenRef.current !== token) return
      setShowDelete(false)
      guard.disarm()
      TrashUndo.offer(trashId, 'entry', url, apiKey, onRestored)
      onDeleted(() => mountedRef.current && actionTokenRef.current === token)
    } catch (caught: unknown) {
      if (store.sessionEpoch() !== epochAtStart || !mountedRef.current || actionTokenRef.current !== token) {
        return
      }
      setDeleteError(caught instanceof Error && caught.message ? caught.message : 'Delete failed')
      deletingRef.current = false
      setDeleting(false)
    }
  }

  return {
    schema,
    uiSchema,
    editorMode,
    baseline,
    formData: activeFormData,
    jsonText,
    jsonValidation,
    formError: displayedFormError,
    extraErrors,
    saving,
    mediaUploading,
    dirty,
    stale,
    canSave,
    canDelete,
    showDelete,
    setShowDelete,
    deleting,
    deleteError,
    setDeleteError,
    showReloadConfirm,
    setShowReloadConfirm,
    formSession,
    formRef,
    jsonEditorRef,
    formContext,
    defaultFormStateBehavior,
    guard,
    switchMode,
    handleFormChange,
    handleFormSubmit,
    handleJsonChange,
    submitEntry,
    reloadLatest: () => {
      if (!entry) return
      setShowReloadConfirm(false)
      resetToEntry(entry)
    },
    discard: () => guard.requestDiscard(onCancel),
    doDelete,
  }
}
