import { useCallback, useEffect, useState } from 'react'
import type { SiloApi } from '../../api/silo-api'
import type { TrashQuery } from '../../api/clients/trash-api'
import type { TrashItem } from '../../api/types/trash-item'
import { ToastManager } from '../../utils/toast-manager'

/** Everything the trash page needs: the page, the filters, and the three
 *  actions a row offers. */
export function useTrash(api: SiloApi, url: string, apiKey: string) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState<TrashQuery>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await api.trash.list(url, apiKey, query)
      setItems(page.items)
      setTotal(page.total)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [api, url, apiKey, query])

  useEffect(() => {
    void load()
  }, [load])

  /** `chain` also restores the containers that are blocking this one. */
  const restore = async (item: TrashItem, options: { rename?: string; chain?: boolean } = {}) => {
    setBusy(item.id)
    try {
      const result = await api.trash.restore(url, apiKey, item.id, options)
      // The broken references are the one outcome worth interrupting for: the
      // restore succeeded, and the content is not whole.
      ToastManager.show(
        result.broken_media_refs.length > 0
          ? `Restored. ${result.broken_media_refs.length} media references no longer resolve.`
          : `Restored ${result.renamed_to ?? item.subject_name}.`,
      )
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  const purge = async (item: TrashItem) => {
    setBusy(item.id)
    try {
      await api.trash.purge(url, apiKey, item.id)
      ToastManager.show(`Deleted ${item.subject_name} permanently.`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  const empty = async () => {
    setBusy('*')
    try {
      const result = await api.trash.empty(url, apiKey)
      ToastManager.show(`Emptied the trash. ${result.purged} items deleted.`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  return {
    items,
    total,
    query,
    setQuery,
    loading,
    error,
    busy,
    reload: load,
    restore,
    purge,
    empty,
    dismissError: () => setError(null),
  }
}
