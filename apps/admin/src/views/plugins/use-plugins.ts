import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { PluginView } from '../../api/types/plugin-view'

export interface PluginsData {
  plugins: PluginView[]
  loading: boolean
  error: string
  reload: () => Promise<void>
}

/**
 * Every plugin with a record on the instance.
 *
 * A record exists from the first time a plugin listed in `silo.toml` is
 * loaded, so this is not the same list as "packages on disk" — a package
 * installed but never listed has nothing here, and `POST /api/plugins/rescan`
 * is what changes that.
 */
export function usePlugins(url: string, apiKey: string): PluginsData {
  const [plugins, setPlugins] = useState<PluginView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPlugins(await api.plugins.list(url, apiKey))
    } catch (caught: any) {
      setPlugins([])
      setError(caught.message || 'Failed to load plugins.')
    } finally {
      setLoading(false)
    }
  }, [url, apiKey])

  useEffect(() => {
    reload()
  }, [reload])

  return { plugins, loading, error, reload }
}
