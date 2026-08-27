import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { PluginView } from '../../api/types/plugin-view'

export interface PluginData {
  plugin: PluginView | null
  loading: boolean
  error: string
  /** Install a view the server just returned. Every mutation answers with the
   *  whole record, so a page never has to re-read to find its new revision —
   *  which is what keeps the next `If-Match` from being stale by construction. */
  apply: (next: PluginView) => void
  reload: () => Promise<void>
}

/** One plugin's record, its runtime, and what its package declares. */
export function usePlugin(url: string, apiKey: string, name: string): PluginData {
  const [plugin, setPlugin] = useState<PluginView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPlugin(await api.plugins.get(url, apiKey, name))
    } catch (caught: any) {
      setPlugin(null)
      setError(caught.message || `Failed to load "${name}".`)
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, name])

  useEffect(() => {
    reload()
  }, [reload])

  return { plugin, loading, error, apply: setPlugin, reload }
}
