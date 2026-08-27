import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '../../api/silo-api'
import type { ImportResult } from '../../api/types/import-result'

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

  const [mode, setMode] = useState<ArchiveMode>('merge')
  const [prefer, setPrefer] = useState<ArchivePrefer>('')
  const [validate, setValidate] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const exportArchive = async () => {
    setExporting(true)
    try {
      const blob = await api.transfer.exportArchive(serverUrl, apiKey, withKeys)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `silo-export-${new Date().toISOString().slice(0, 10)}.tar.gz`
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

  const runPreview = async (
    archive: File,
    overrides?: { mode?: ArchiveMode; prefer?: ArchivePrefer; validate?: boolean },
  ) => {
    setBusy(true)
    setError('')
    setApplied(null)
    setPreview(null)
    try {
      setPreview(
        await api.transfer.importArchive(serverUrl, apiKey, archive, {
          mode: overrides?.mode ?? mode,
          prefer: overrides?.prefer ?? prefer,
          validate: overrides?.validate ?? validate,
          dryRun: true,
        }),
      )
    } catch (caught: any) {
      setError(caught.message || 'Import preview failed')
    } finally {
      setBusy(false)
    }
  }

  return {
    withKeys,
    setWithKeys,
    exporting,
    exportArchive,

    mode,
    prefer,
    validate,
    file,
    preview,
    applied,
    busy,
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
    changeValidate: (next: boolean) => {
      setValidate(next)
      if (file) runPreview(file, { validate: next })
    },

    pickFile: (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0]
      if (!chosen) return
      setFile(chosen)
      runPreview(chosen)
      // Cleared so choosing the same file twice fires again.
      event.target.value = ''
    },

    apply: async () => {
      if (!file) return
      setBusy(true)
      setError('')
      try {
        setApplied(
          await api.transfer.importArchive(serverUrl, apiKey, file, {
            mode,
            prefer,
            validate,
            dryRun: false,
          }),
        )
        setPreview(null)
        onImported()
      } catch (caught: any) {
        setError(caught.message || 'Import failed')
      } finally {
        setBusy(false)
      }
    },

    reset: () => {
      setFile(null)
      setPreview(null)
      setApplied(null)
      setError('')
    },
  }
}
