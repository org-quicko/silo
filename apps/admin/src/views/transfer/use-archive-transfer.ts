import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '../../api/silo-api'
import type { ImportResult } from '../../api/types/import-result'
import type { MediaMode } from '../../api/types/media-mode'
import type { TransferProgress } from '../../api/transport/progress-reader'
import { ArchiveName } from './archive-name'

/** Whether an import empties a collection first, or writes over it. */
export type ArchiveMode = 'merge' | 'replace'

/** Which side wins a conflict — empty means the server's newest-wins rule. */
export type ArchivePrefer = '' | 'local' | 'remote'

/**
 * The whole-instance archive: downloading one, and previewing then applying
 * one.
 *
 * An import is always previewed before it is applied — the dry run is what
 * turns "replace mode over 4,000 entries" into a number the operator can look
 * at first.
 */
export function useArchiveTransfer(
  serverUrl: string,
  apiKey: string,
  onImported: () => void,
) {
  const [withKeys, setWithKeys] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Empty is the whole instance, which is what an absent `include` means to
  // the server too.
  const [exportInclude, setExportInclude] = useState<string[]>([])
  const [exportMedia, setExportMedia] = useState<MediaMode>('all')
  // Until the operator picks one, media follows the selection the way the
  // server's own default does: everything for a whole export, only what the
  // entries point at once it is narrowed.
  const [exportMediaChosen, setExportMediaChosen] = useState(false)
  const [importMedia, setImportMedia] = useState<MediaMode>('all')

  const [mode, setMode] = useState<ArchiveMode>('merge')
  const [prefer, setPrefer] = useState<ArchivePrefer>('')

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const exportArchive = async () => {
    setExporting(true)
    setError('')
    try {
      const blob = await api.transfer.exportArchive(serverUrl, apiKey, {
        withKeys,
        include: exportInclude,
        media: exportMedia,
      })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = ArchiveName.of()
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (caught: any) {
      setError(caught.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const runImport = async (
    archive: File,
    overrides?: { mode?: ArchiveMode; prefer?: ArchivePrefer; media?: MediaMode; dryRun?: boolean },
  ) =>
    api.transfer.importArchive(serverUrl, apiKey, archive, {
      mode: overrides?.mode ?? mode,
      prefer: overrides?.prefer ?? prefer,
      media: overrides?.media ?? importMedia,
      // The archive decides what it holds; the import does not narrow it
      // further from here. Narrowing belongs on the export that made it.
      include: [],
      dryRun: overrides?.dryRun ?? true,
      onProgress: setProgress,
    })

  const runPreview = async (
    archive: File,
    overrides?: { mode?: ArchiveMode; prefer?: ArchivePrefer; media?: MediaMode },
  ) => {
    setBusy(true)
    setError('')
    setApplied(null)
    setPreview(null)
    try {
      setPreview(await runImport(archive, { ...overrides, dryRun: true }))
    } catch (caught: any) {
      setError(caught.message || 'Import preview failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return {
    withKeys,
    setWithKeys,
    exporting,
    exportArchive,
    exportInclude,
    setExportInclude: (next: string[]) => {
      setExportInclude(next)
      if (!exportMediaChosen) setExportMedia(next.length > 0 ? 'referenced' : 'all')
    },
    exportMedia,
    setExportMedia: (next: MediaMode) => {
      setExportMediaChosen(true)
      setExportMedia(next)
    },
    importMedia,

    mode,
    prefer,
    file,
    preview,
    applied,
    busy,
    progress,
    error,
    fileInput,
    /** Added + updated + deleted, as the preview reports them. */
    changeCount: preview ? preview.added + preview.updated + preview.deleted : 0,

    /** Each option re-previews with the new setting, so what is shown always
     *  describes what would happen. */
    changeMode: (next: ArchiveMode) => {
      setMode(next)
      if (file) runPreview(file, { mode: next })
    },
    changePrefer: (next: ArchivePrefer) => {
      setPrefer(next)
      if (file) runPreview(file, { prefer: next })
    },
    changeImportMedia: (next: MediaMode) => {
      setImportMedia(next)
      if (file) runPreview(file, { media: next })
    },
    pickFile: (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0]
      if (!chosen) return
      setFile(chosen)
      runPreview(chosen)
      // Cleared so choosing the same file twice fires again.
      event.target.value = ''
    },

    /** The same thing a drop hands over — one file, previewed immediately. */
    takeFile: (chosen: File) => {
      setFile(chosen)
      runPreview(chosen)
    },

    apply: async () => {
      if (!file) return
      setBusy(true)
      setError('')
      try {
        setApplied(await runImport(file, { dryRun: false }))
        setPreview(null)
        onImported()
      } catch (caught: any) {
        setError(caught.message || 'Import failed')
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },

    reset: () => {
      setFile(null)
      setPreview(null)
      setApplied(null)
      setError('')
      setProgress(null)
    },
  }
}
