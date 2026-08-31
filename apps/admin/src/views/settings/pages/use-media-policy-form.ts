import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../api/silo-api'
import type { MediaPolicyView } from '../../../api/types/media-settings'
import { MediaPolicyDraft, type MediaPolicyFields } from './media-policy-draft'

/**
 * The library form: what the server reports, what is being typed, and the one
 * call that saves it (D46).
 *
 * Its own state rather than a second half of `useMediaStorageForm`, because
 * the two write different tables through different routes. Sharing one Save
 * would make correcting a typo in the allowlist depend on the bucket still
 * opening, which is exactly the coupling the two routes exist to avoid.
 */
export function useMediaPolicyForm(url: string, apiKey: string, canConfigure: boolean) {
  const [view, setView] = useState<MediaPolicyView | null>(null)
  const [draft, setDraft] = useState<MediaPolicyFields>({
    base_url: '',
    base_url_target: 'server',
    extensions: [],
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const adopt = useCallback((next: MediaPolicyView) => {
    setView(next)
    setDraft(MediaPolicyDraft.of(next))
  }, [])

  const load = useCallback(async () => {
    // The claim gates the route, so a key without it would only ever get a 403
    // to render. `loading` is left alone because the session's claims arrive
    // after first paint.
    if (!canConfigure) return
    setLoading(true)
    setError('')
    try {
      adopt(await api.media.settings(url, apiKey))
    } catch (failure: any) {
      setError(failure.message || 'Could not read the media settings.')
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, canConfigure, adopt])

  useEffect(() => {
    load()
  }, [load])

  const set = <K extends keyof MediaPolicyFields>(field: K, value: MediaPolicyFields[K]) => {
    setSaved(false)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      adopt(await api.media.saveSettings(url, apiKey, MediaPolicyDraft.payload(draft)))
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
    loading,
    saving,
    saved,
    error,
    dirty: !!view && MediaPolicyDraft.changed(draft, view),
    reload: load,
    save,
  }
}
