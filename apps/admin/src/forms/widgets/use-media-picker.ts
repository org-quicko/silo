import { useCallback, useEffect, useRef, useState } from 'react'
import { MediaRef } from '@silo/shared/media-ref'
import { api } from '../../api/silo-api'
import type { MediaAsset } from '../../api/types/media-asset'
import { MediaPickerQuery, type MediaPickerState } from './media-picker-query'
import { MediaUploadPending } from './media-upload-pending'
import { MediaValue } from './media-value'
import { RequestSequence } from './request-sequence'

/**
 * The media field's two jobs: resolving what it currently points at, and
 * browsing or uploading into the library to change it.
 */
export function useMediaPicker(
  url: string | undefined,
  apiKey: string | undefined,
  value: string | undefined,
  onChange: (next: string) => void,
  canUpload = true,
) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<MediaPickerState>(() => MediaPickerQuery.initial())
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [total, setTotal] = useState(0)
  const [folders, setFolders] = useState<string[]>([])
  const [selected, setSelected] = useState<MediaAsset | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadingConnection, setUploadingConnection] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState('')

  const listSequenceRef = useRef(new RequestSequence())
  const foldersSequenceRef = useRef(new RequestSequence())
  const uploadSequenceRef = useRef(new RequestSequence())
  const debounceRef = useRef(false)
  const uploadingRef = useRef(false)

  const selectedId = MediaValue.idOf(value)
  const currentConnection = MediaUploadPending.connectionKey(url, apiKey)
  const connected = currentConnection !== null
  const uploading = MediaUploadPending.isUploading(uploadingConnection, url, apiKey)

  const invalidateUpload = useCallback(() => {
    uploadSequenceRef.current.invalidate()
    uploadingRef.current = false
    setUploadingConnection(null)
  }, [])

  const loadList = useCallback(
    async (nextQuery: MediaPickerState, serverUrl: string, key: string) => {
      const requestId = listSequenceRef.current.next()
      setLoading(true)
      setError('')
      try {
        const page = await api.media.list(serverUrl, key, MediaPickerQuery.toApiQuery(nextQuery))
        if (!listSequenceRef.current.isCurrent(requestId)) return
        if (page.total > 0) {
          const clamped = MediaPickerQuery.clampPage(nextQuery, page.total)
          if (clamped.page !== nextQuery.page) {
            setQuery(clamped)
            return
          }
        }
        setAssets(page.items)
        setTotal(page.total)
      } catch (caught: unknown) {
        if (!listSequenceRef.current.isCurrent(requestId)) return
        setAssets([])
        setTotal(0)
        setError(caught instanceof Error ? caught.message : 'Failed to load the media library.')
      } finally {
        if (listSequenceRef.current.isCurrent(requestId)) {
          setLoading(false)
        }
      }
    },
    [],
  )

  // Invalidate any in-flight requests when switching servers or unmounting.
  useEffect(() => {
    const listSequence = listSequenceRef.current
    const foldersSequence = foldersSequenceRef.current
    const uploadSequence = uploadSequenceRef.current
    return () => {
      listSequence.invalidate()
      foldersSequence.invalidate()
      uploadSequence.invalidate()
      uploadingRef.current = false
    }
  }, [url, apiKey])

  // The entry stores an id and a read resolves it to a URL, so neither form
  // carries the file's name. Fetch the one asset this field points at, rather
  // than making the reader open the picker to find out what they picked.
  useEffect(() => {
    if (!selectedId || !url || !apiKey) return

    let live = true
    api.media
      .get(url, apiKey, selectedId)
      .then((asset) => {
        if (live) setSelected(asset)
      })
      .catch(() => {
        if (live) setSelected(null)
      })

    return () => {
      live = false
    }
  }, [selectedId, url, apiKey])

  // Search keystrokes debounce for 250ms; folder, type, pagination, and initial
  // open fetch immediately so UI interactions stay crisp.
  useEffect(() => {
    const listSequence = listSequenceRef.current
    if (!open || !url || !apiKey) {
      listSequence.invalidate()
      return
    }
    const delay = debounceRef.current ? 250 : 0
    const timer = setTimeout(() => {
      debounceRef.current = false
      void loadList(query, url, apiKey)
    }, delay)
    return () => clearTimeout(timer)
  }, [open, query, url, apiKey, loadList])

  useEffect(() => {
    const foldersSequence = foldersSequenceRef.current
    if (!open || !url || !apiKey) {
      foldersSequence.invalidate()
      return
    }
    const requestId = foldersSequence.next()
    api.media
      .listFolders(url, apiKey)
      .then((folderList) => {
        if (foldersSequence.isCurrent(requestId)) setFolders(folderList)
      })
      .catch(() => {
        if (foldersSequence.isCurrent(requestId)) setFolders([])
      })
    return () => {
      foldersSequence.invalidate()
    }
  }, [open, url, apiKey])

  const resolvedSelected =
    selectedId && connected && selected?.id === selectedId ? selected : null

  return {
    open,
    assets: connected ? assets : [],
    total: connected ? total : 0,
    folders: connected ? folders : [],
    selected: resolvedSelected,
    selectedId,
    search: query.search,
    folder: query.folder,
    type: query.type,
    page: query.page,
    pageSize: query.pageSize,
    loading: connected ? loading : false,
    uploading,
    error: connected ? error : 'Not connected to a silo server — cannot list media.',
    uploadError,
    connected,

    setSearch: (nextSearch: string) => {
      listSequenceRef.current.invalidate()
      debounceRef.current = true
      setQuery((current) => MediaPickerQuery.withSearch(current, nextSearch))
    },

    setFolder: (nextFolder: string) => {
      listSequenceRef.current.invalidate()
      debounceRef.current = false
      setQuery((current) => MediaPickerQuery.withFolder(current, nextFolder))
    },

    setType: (nextType: string) => {
      listSequenceRef.current.invalidate()
      debounceRef.current = false
      setQuery((current) => MediaPickerQuery.withType(current, nextType))
    },

    setPage: (nextPage: number) => {
      listSequenceRef.current.invalidate()
      debounceRef.current = false
      setQuery((current) => MediaPickerQuery.withPage(current, nextPage))
    },

    setPageSize: (nextPageSize: number) => {
      listSequenceRef.current.invalidate()
      debounceRef.current = false
      setQuery((current) => MediaPickerQuery.withPageSize(current, nextPageSize))
    },

    clearUploadError: () => setUploadError(''),

    cancelUpload: () => {
      invalidateUpload()
      setUploadError('')
    },

    openPicker: () => {
      debounceRef.current = false
      listSequenceRef.current.invalidate()
      invalidateUpload()
      setUploadError('')
      setOpen(true)
    },

    closePicker: () => {
      debounceRef.current = false
      listSequenceRef.current.invalidate()
      foldersSequenceRef.current.invalidate()
      invalidateUpload()
      setLoading(false)
      setUploadError('')
      setOpen(false)
    },

    upload: async (file: File, targetFolder?: string) => {
      if (!file || !canUpload || uploadingRef.current) return
      if (!url || !apiKey || !currentConnection) {
        setUploadError('Not connected to a silo server — cannot upload media.')
        return
      }

      const uploadId = uploadSequenceRef.current.next()
      uploadingRef.current = true
      setUploadingConnection(currentConnection)
      setUploadError('')
      try {
        const asset = await api.media.upload(url, apiKey, file, targetFolder || undefined)
        if (!uploadSequenceRef.current.isCurrent(uploadId)) return
        // Store the reference, not the URL: this is what survives a rename and
        // what the delete guard counts.
        setSelected(asset)
        onChange(MediaRef.url(asset.id))
        setOpen(false)
      } catch (caught: unknown) {
        if (!uploadSequenceRef.current.isCurrent(uploadId)) return
        setUploadError(caught instanceof Error ? caught.message : 'Upload failed')
      } finally {
        if (uploadSequenceRef.current.isCurrent(uploadId)) {
          uploadingRef.current = false
          setUploadingConnection(null)
        }
      }
    },

    choose: (asset: MediaAsset) => {
      invalidateUpload()
      setUploadError('')
      setSelected(asset)
      onChange(MediaRef.url(asset.id))
      setOpen(false)
    },
  }
}
