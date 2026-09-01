import { useCallback, useState } from 'react'
import type { RenameResult } from '../../../api/types/scope-record'

/** What the flow needs to know about the thing being renamed. */
export interface RenameSubject {
  /** "project", "environment" or "collection", for the copy. */
  noun: string
  currentName: string
  /** The record's id, which is what the request is bound to. */
  id: string
}

interface Options {
  subject: RenameSubject
  /** `dryRun` decides whether the request writes. Both call the same route. */
  rename: (name: string, dryRun: boolean) => Promise<RenameResult>
  /** Run after a real rename lands, with the new name — for navigating and for
   *  clearing anything that remembered the old one. */
  onRenamed: (name: string) => void | Promise<void>
}

/**
 * The two-step rename: ask what would change, show it, then do it.
 *
 * The preview step is not ceremony. A rename rewrites claim strings, and some
 * claims name the subject through a wildcard ancestor — those are **not**
 * rewritten, because a claim whose project segment is a wildcard and whose env
 * segment is a literal `dev` means "any project's dev", and moving it would
 * change authority everywhere. Their reach does change though. Nothing else in
 * the product would ever tell the operator that, so the flow asks the server
 * what it is about to do and prints both lists before writing anything (D51).
 *
 * The same shape as `useMediaRenameFolderFlow`: a first request whose refusal or
 * result opens a second dialog, rather than two independent controls.
 */
export function useRenameFlow({ subject, rename, onRenamed }: Options) {
  const [preview, setPreview] = useState<RenameResult | null>(null)
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cancel = useCallback(() => {
    setPreview(null)
    setPending('')
    setError('')
  }, [])

  /** Step one: a dry run, so the confirm dialog can say what will happen. */
  const start = useCallback(
    async (name: string) => {
      const wanted = name.trim()
      if (!wanted || wanted === subject.currentName) return

      setBusy(true)
      setError('')
      try {
        setPreview(await rename(wanted, true))
        setPending(wanted)
      } catch (caught: any) {
        setError(caught.message || `Failed to rename this ${subject.noun}`)
      } finally {
        setBusy(false)
      }
    },
    [rename, subject.currentName, subject.noun],
  )

  /** Step two: the real thing. */
  const confirm = useCallback(async () => {
    if (!pending) return

    setBusy(true)
    setError('')
    try {
      await rename(pending, false)
      setPreview(null)
      setPending('')
      await onRenamed(pending)
    } catch (caught: any) {
      setError(caught.message || `Failed to rename this ${subject.noun}`)
    } finally {
      setBusy(false)
    }
  }, [onRenamed, pending, rename, subject.noun])

  return { preview, pending, busy, error, start, confirm, cancel }
}
