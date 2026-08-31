import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../api/silo-api'
import type { MediaStorageView } from '../../../api/types/media-storage'
import { MediaStorageDraft, type MediaStorageFields } from './media-storage-draft'

/**
 * The media storage form: what the server reports, what is being typed, and the
 * one call that saves it.
 *
 * The secret has three states rather than two, because the read cannot return
 * it: untouched sends nothing and the server keeps the file's, typed sends it,
 * and cleared sends `''`, which is the only way to remove one. Anything less
 * would make an operator re-enter a credential they cannot read every time they
 * changed a region.
 *
 * Clearing is also the door into typing. A stored secret shows as a mask its
 * box will not let you edit, so replacing one is clear-then-type and the two
 * flags are set together rather than exclusively.
 */
export function useMediaStorageForm(url: string, apiKey: string, canConfigure: boolean) {
  const [view, setView] = useState<MediaStorageView | null>(null)
  const [draft, setDraft] = useState<MediaStorageFields>(
    MediaStorageDraft.of({ driver: 'fs', secret_access_key_set: false }),
  )
  const [secret, setSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const adopt = useCallback((next: MediaStorageView) => {
    setView(next)
    setDraft(MediaStorageDraft.of(next.file))
    setSecret('')
    setClearSecret(false)
  }, [])

  const load = useCallback(async () => {
    // The claim gates the route, so a key without it would only ever get a 403
    // to render. The page says what is missing instead, and `loading` is left
    // alone because the session's claims arrive after first paint: a key that
    // turns out to hold the claim must not have been reported as refused on the
    // way there.
    if (!canConfigure) return
    setLoading(true)
    setError('')
    try {
      adopt(await api.media.storage(url, apiKey))
    } catch (failure: any) {
      setError(failure.message || 'Could not read the media storage settings.')
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, canConfigure, adopt])

  useEffect(() => {
    load()
  }, [load])

  const set = <K extends keyof MediaStorageFields>(field: K, value: MediaStorageFields[K]) => {
    setSaved(false)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      adopt(
        await api.media.saveStorage(url, apiKey, MediaStorageDraft.payload(draft, secret, clearSecret)),
      )
      setSaved(true)
    } catch (failure: any) {
      setError(failure.message || 'The settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return {
    view,
    draft,
    set,
    secret,
    // Typing does not cancel the clear that opened the box: a replacement is
    // one gesture, and dropping the flag halfway through would mask the field
    // again under the cursor.
    setSecret: (value: string) => {
      setSaved(false)
      setSecret(value)
    },
    clearSecret,
    // Both ways: taking it back drops whatever was typed, so "Keep it" leaves
    // the stored secret exactly as it was.
    setClearSecret: (value: boolean) => {
      setSaved(false)
      setSecret('')
      setClearSecret(value)
    },
    loading,
    saving,
    saved,
    error,
    // Compared against the file rather than against what is in force, so an
    // env var holding a different bucket does not make the form look edited.
    dirty:
      !!view && (MediaStorageDraft.changed(draft, view.file) || !!secret || clearSecret),
    reload: load,
    save,
  }
}
