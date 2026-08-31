import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/silo-api'
import type { ConfigSettingsView } from '../../../api/types/settings'

/**
 * The configuration page's data (D47): what the server reports, and the one
 * call that saves a single table.
 *
 * One hook for the whole page rather than one per card, because the read is one
 * request and a save answers with the whole view — saving `[log]` can change
 * what `[search]` reports about a pending restart, and two hooks would leave
 * the second card showing a state the server had already moved past.
 */
export function useConfigSettingsForm(url: string, apiKey: string, canConfigure: boolean) {
  const [view, setView] = useState<ConfigSettingsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    // The claim gates the route, so a key without it would only ever get a 403
    // to render. `loading` is left alone because the session's claims arrive
    // after first paint.
    if (!canConfigure) return
    setLoading(true)
    setError('')
    try {
      setView(await api.settings.read(url, apiKey))
    } catch (failure: any) {
      setError(failure.message || 'Could not read the server settings.')
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, canConfigure])

  useEffect(() => {
    load()
  }, [load])

  /** Saves one table and adopts the whole view it answers with. Throws on
   *  failure so the card that asked can show the message against itself,
   *  rather than the page showing one error for four forms. */
  const saveSection = async (table: string, input: Record<string, unknown>) => {
    setView(await api.settings.saveSection(url, apiKey, table, input))
  }

  return { view, loading, error, reload: load, saveSection }
}
