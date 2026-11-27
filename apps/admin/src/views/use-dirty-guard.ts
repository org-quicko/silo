import { useCallback, useEffect, useRef, useState } from 'react'
import { router } from '../router/router'

export interface DirtyGuard {
  confirming: boolean
  requestDiscard: (discardAction: () => void) => void
  confirmDiscard: () => void
  cancelDiscard: () => void
  disarm: () => void
}

/**
 * Protects unsaved editor changes across in-app navigation, browser back,
 * browser tab close/reload (`beforeunload`), and Discard / Escape actions.
 */
export function useDirtyGuard(dirty: boolean): DirtyGuard {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const dirtyRef = useRef(dirty)
  const disarmedRef = useRef(false)
  const releaseBlockerRef = useRef<(() => void) | null>(null)

  if (!dirty && pendingAction !== null) {
    setPendingAction(null)
  }

  useEffect(() => {
    dirtyRef.current = dirty
    if (dirty) disarmedRef.current = false
  }, [dirty])

  useEffect(() => {
    if (!dirty || disarmedRef.current) {
      releaseBlockerRef.current?.()
      releaseBlockerRef.current = null
      return
    }

    const release = router.block((proceed) => {
      setPendingAction(() => proceed)
    })
    releaseBlockerRef.current = release

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || disarmedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      release()
      if (releaseBlockerRef.current === release) releaseBlockerRef.current = null
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty])

  const disarm = useCallback(() => {
    disarmedRef.current = true
    releaseBlockerRef.current?.()
    releaseBlockerRef.current = null
    setPendingAction(null)
  }, [])

  const requestDiscard = useCallback((discardAction: () => void) => {
    if (!dirtyRef.current || disarmedRef.current) {
      discardAction()
      return
    }
    setPendingAction(() => discardAction)
  }, [])

  const confirmDiscard = useCallback(() => {
    const action = pendingAction
    disarm()
    action?.()
  }, [pendingAction, disarm])

  const cancelDiscard = useCallback(() => {
    setPendingAction(null)
  }, [])

  return {
    confirming: dirty && pendingAction !== null,
    requestDiscard,
    confirmDiscard,
    cancelDiscard,
    disarm,
  }
}
