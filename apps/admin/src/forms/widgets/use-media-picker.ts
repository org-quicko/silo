import { useEffect, useState } from 'react'
import { MediaRef } from '@silo/shared/media-ref'
import { api } from '../../api/silo-api'
import type { MediaAsset } from '../../api/types/media-asset'
import { MediaValue } from './media-value'

/** How many assets the picker lists at once. Searched server-side, so this is
 *  a page rather than the whole catalog. */
const PickerLimit = 100

/**
 * The media field's two jobs: resolving what it currently points at, and
 * browsing the library to change it.
 */
export function useMediaPicker(
  url: string | undefined,
  apiKey: string | undefined,
  value: string | undefined,
  onChange: (next: string) => void,
) {
  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [selected, setSelected] = useState<MediaAsset | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const selectedId = MediaValue.idOf(value)
  const connected = Boolean(url && apiKey)

  const load = async () => {
    if (!url || !apiKey) {
      setAssets([])
      setError('Not connected to a silo server — cannot list media.')
      return
    }

    setLoading(true)
    setError('')
    try {
      // Searched server-side through the catalog, so the picker is not limited
      // to whatever fits in one unpaginated response.
      const page = await api.media.list(url, apiKey, {
        q: search.trim() || undefined,
        recursive: true,
        limit: PickerLimit,
      })
      setAssets(page.items)
    } catch (caught: any) {
      setAssets([])
      setError(caught?.message || 'Failed to load the media library.')
    } finally {
      setLoading(false)
    }
  }

  // The entry stores an id and a read resolves it to a URL, so neither form
  // carries the file's name. Fetch the one asset this field points at, rather
  // than making the reader open the picker to find out what they picked.
  useEffect(() => {
    if (!selectedId || !url || !apiKey) {
      setSelected(null)
      return
    }

    let live = true
    api.media
      .get(url, apiKey, selectedId)
      .then((asset) => live && setSelected(asset))
      .catch(() => live && setSelected(null))

    return () => {
      live = false
    }
  }, [selectedId, url, apiKey])

  // A keystroke in the picker is a request. Debounced to one per pause, and
  // only while the picker is open.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, open])

  return {
    open,
    assets,
    selected,
    selectedId,
    search,
    setSearch,
    loading,
    uploading,
    error,
    connected,

    openPicker: () => {
      setOpen(true)
      load()
    },
    closePicker: () => setOpen(false),

    upload: async (file: File) => {
      if (!file) return
      if (!url || !apiKey) {
        setError('Not connected to a silo server — cannot upload media.')
        return
      }

      setUploading(true)
      try {
        const asset = await api.media.upload(url, apiKey, file)
        // Store the reference, not the URL: this is what survives a rename and
        // what the delete guard counts.
        onChange(MediaRef.url(asset.id))
        setOpen(false)
      } catch (caught: any) {
        setError(caught.message || 'Upload failed')
      } finally {
        setUploading(false)
      }
    },

    choose: (asset: MediaAsset) => {
      onChange(MediaRef.url(asset.id))
      setOpen(false)
    },
  }
}
