import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RenameResult } from '../../../api/types/scope-record'
import { RenameEligibility } from './rename-eligibility'

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
  /** Whether initiating or committing this rename is currently allowed. */
  allowed?: boolean
  /** Imperative commit-time re-check so unsaved edits block confirmation. */
  canCommit?: () => boolean
  /** `dryRun` decides whether the request writes. Both call the same route. */
  rename: (name: string, dryRun: boolean) => Promise<RenameResult>
  /** Optional wrapper around the real commit (`confirm`) so callers with an
   *  external mutation lock can hold it from before `rename(..., false)`
   *  through `onRenamed` completion. */
  runCommit?: (
    commit: (isCurrent: () => boolean, mutationIdAtStart?: number | null) => Promise<void>,
  ) => Promise<void>
  /** Run after a real rename lands, with the new name — for navigating and for
   *  clearing anything that remembered the old one. */
  onRenamed: (
    name: string,
    isCurrent?: () => boolean,
    mutationIdAtStart?: number | null,
  ) => void | Promise<void>
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
export function useRenameFlow({
  subject,
  allowed = true,
  canCommit,
  rename,
  runCommit,
  onRenamed,
}: Options) {
  const [preview, setPreview] = useState<RenameResult | null>(null)
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const allowedRef = useRef(allowed)
  useLayoutEffect(() => {
    allowedRef.current = allowed
  }, [allowed])

  if (
    RenameEligibility.shouldDiscardOpenPreview({
      allowed,
      busy,
      hasPreview: preview !== null || pending !== '',
    })
  ) {
    setPreview(null)
    setPending('')
  }

  const cancel = useCallback(() => {
    setPreview(null)
    setPending('')
    setError('')
  }, [])

  /** Step one: a dry run, so the confirm dialog can say what will happen. */
  const start = useCallback(
    async (name: string) => {
      const wanted = name.trim()
      if (!wanted || wanted === subject.currentName || !allowedRef.current) return

      setBusy(true)
      setError('')
      try {
        const nextPreview = await RenameEligibility.fetchPreviewIfAllowed({
          isAllowed: () => allowedRef.current,
          dryRun: () => rename(wanted, true),
        })
        if (!nextPreview) return
        setPreview(nextPreview)
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
    if (
      !RenameEligibility.canBeginCommit({
        pending,
        allowed: allowed && allowedRef.current,
        canCommit,
      })
    ) {
      setPreview(null)
      setPending('')
      return
    }

    setBusy(true)
    setError('')
    const execute = async (isCurrent: () => boolean, mutationIdAtStart?: number | null) => {
      const outcome = await RenameEligibility.commitIfEligible({
        pending,
        // `canCommit` carries live commit-time invariants (e.g. `!dirty`) without
        // blocking on the outer `saving` lock already acquired by `runCommit`.
        isAllowed: canCommit ?? (() => allowedRef.current),
        execute: async () => {
          await rename(pending, false)
          if (!isCurrent()) return
          setPreview(null)
          setPending('')
          await onRenamed(pending, isCurrent, mutationIdAtStart)
        },
      })
      if (outcome === 'ineligible' && isCurrent()) {
        setPreview(null)
        setPending('')
      }
    }
    try {
      if (runCommit) {
        await runCommit(execute)
      } else {
        await execute(() => true)
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : `Failed to rename this ${subject.noun}`,
      )
    } finally {
      setBusy(false)
    }
  }, [allowed, canCommit, onRenamed, pending, rename, runCommit, subject.noun])

  return { preview, pending, busy, error, start, confirm, cancel }
}
