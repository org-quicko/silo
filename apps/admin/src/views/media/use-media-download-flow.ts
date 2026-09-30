import { useState } from 'react'
import { api } from '../../api/silo-api'
import type { MediaArchive } from '../../api/types/media-archive'
import type { MediaAsset } from '../../api/types/media-asset'
import { BrowserDownload } from './browser-download'
import { MediaFileUrl } from './media-file-url'
import { MediaLibraryError } from './media-library-error'

/**
 * Bulk download, the way a cloud drive does it (D106): one file downloads as
 * itself, anything more is zipped on the server. A download that fits one
 * part starts at once; one split into parts opens `DownloadArchiveDialog`.
 */
export function useMediaDownloadFlow(
  url: string,
  apiKey: string,
  baseUrl: string,
  onError: (message: string) => void,
  onStarted: (message: string) => void,
) {
  const [busy, setBusy] = useState(false)
  const [archive, setArchive] = useState<MediaArchive | null>(null)

  const open = (relative: string) => BrowserDownload.start(MediaFileUrl.join(relative, baseUrl))

  const start = async (assets: MediaAsset[], folderPaths: string[]) => {
    if (assets.length === 1 && folderPaths.length === 0) {
      BrowserDownload.start(MediaFileUrl.downloadUrl(assets[0], baseUrl))
      onStarted('Download started')
      return
    }
    setBusy(true)
    try {
      const prepared = await api.media.prepareArchive(
        url,
        apiKey,
        assets.map((asset) => asset.id),
        folderPaths,
      )
      const [only] = prepared.parts
      if (prepared.parts.length === 0 && prepared.separate.length === 0) {
        onError('Nothing to download: the selected files are being deleted.')
      } else if (only && prepared.parts.length === 1 && prepared.separate.length === 0) {
        open(only.url)
        onStarted(`Zipping ${prepared.files} ${prepared.files === 1 ? 'file' : 'files'}. Download started`)
      } else {
        setArchive(prepared)
      }
    } catch (failure) {
      onError(MediaLibraryError.message(failure, 'Could not prepare the download'))
    } finally {
      setBusy(false)
    }
  }

  return { busy, archive, start, open, close: () => setArchive(null) }
}
