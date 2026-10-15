import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../api/api-error'
import { api } from '../../../api/silo-api'
import type { Entry } from '../../../api/types/entry'
import type { PrepareTransferOptions } from '../../../api/types/prepare-transfer-options'
import type { PreparedTransfer } from '../../../api/types/prepared-transfer'
import type { ScopeRef } from '../../../api/types/scope-ref'
import type { Server } from '../../servers/server'

/** Why a preview can no longer be applied and has to be made again. */
export type RemoteTransferRedo = 'stale' | 'expired'

/**
 * One transfer from another server, from preview to apply (D109–D111).
 *
 * The preview is the plan this server saved, so Apply writes exactly it or
 * nothing. A preparation holds one of the server's few slots for an hour, so
 * it is cancelled once it stops matching the form: when an input changes, when
 * the page goes, and when the tab closes. One whose id arrives after the form
 * moved on is cancelled as soon as a progress line names it.
 */
export function useRemoteTransfer(server: Server, destination: ScopeRef, options: PrepareTransferOptions | null) {
  const [transfer, setTransfer] = useState<PreparedTransfer | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [redo, setRedo] = useState<RemoteTransferRedo | null>(null)
  const [inspected, setInspected] = useState<Entry | null>(null)
  const ticket = useRef(0)
  const open = useRef<string | null>(null)
  const target = useRef({ server, destination })
  const signature = options ? JSON.stringify(options) : ''
  const { url, apiKey } = server

  const cancel = (id: string) => {
    const { server: at, destination: to } = target.current
    void api.preparedTransfers.cancel(at.url, at.apiKey, to, id, true).catch(() => {})
  }
  const hold = (id: string | null) => {
    open.current = id
    setHeld(id)
  }
  const release = () => {
    if (open.current) cancel(open.current)
    hold(null)
  }
  const reset = () => {
    ticket.current++
    release()
    setTransfer(null)
    setPhase(null)
    setBusy(false)
    setError('')
    setRedo(null)
    setInspected(null)
  }
  const adopt = (view: PreparedTransfer) => {
    setTransfer(view)
    if (view.state === 'stale' || view.state === 'expired') setRedo(view.state)
    if (view.state !== 'preparing' && view.state !== 'prepared' && view.state !== 'applying') hold(null)
  }
  const say = (caught: unknown) => setError(caught instanceof Error ? caught.message : 'Transfer failed')

  useEffect(() => {
    target.current = { server, destination }
  })

  useEffect(() => reset, [signature])

  useEffect(() => {
    const leave = () => {
      if (open.current) cancel(open.current)
    }
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [])

  /** Runs one call, dropping its answer if the form moved on meanwhile. */
  const run = async (work: (mine: number) => Promise<void>, failed: (caught: unknown, mine: number) => Promise<void>) => {
    const mine = ticket.current
    setBusy(true)
    setError('')
    try {
      await work(mine)
    } catch (caught) {
      if (mine === ticket.current) await failed(caught, mine)
    } finally {
      if (mine === ticket.current) {
        setBusy(false)
        setPhase(null)
      }
    }
  }

  const prepare = () => {
    if (!options || busy) return
    reset()
    const mine = ticket.current
    const orphaned = new Set<string>()
    const claim = (id: string) => {
      if (mine === ticket.current) hold(id)
      else if (!orphaned.has(id)) {
        orphaned.add(id)
        cancel(id)
      }
    }
    setPhase('fetch')
    void run(async () => {
      const view = await api.preparedTransfers.prepare(url, apiKey, destination, options, (progress) => {
        if (!progress.transfer) return
        claim(progress.transfer.id)
        if (mine === ticket.current) setPhase(progress.phase)
      })
      claim(view.id)
      if (mine === ticket.current) adopt(view)
    }, async (caught) => {
      // A pull cut off on the way may still be running there.
      release()
      say(caught)
    })
  }

  const page = (offset: number) => {
    if (!transfer || busy) return
    const id = transfer.id
    setInspected(null)
    void run(async (mine) => {
      const view = await api.preparedTransfers.read(url, apiKey, destination, id, offset)
      if (mine === ticket.current) adopt(view)
    }, async (caught) => say(caught))
  }

  const apply = () => {
    if (transfer?.state !== 'prepared' || busy) return
    const id = transfer.id
    setInspected(null)
    setPhase('media')
    void run(async (mine) => {
      const view = await api.preparedTransfers.apply(url, apiKey, destination, id, (progress) => {
        if (progress.transfer && mine === ticket.current) setPhase(progress.phase)
      })
      if (mine === ticket.current) adopt(view)
    }, async (caught, mine) => {
      const code = caught instanceof ApiError ? caught.code : ''
      if (code === 'stale_preview' || code === 'transfer_expired') {
        hold(null)
        setRedo(code === 'stale_preview' ? 'stale' : 'expired')
        return
      }
      // A lost answer says nothing about what happened, so the server is asked.
      const known = await api.preparedTransfers.read(url, apiKey, destination, id).catch(() => null)
      if (mine !== ticket.current) return
      if (known) adopt(known)
      if (known?.state !== 'applied') say(caught)
    })
  }

  const inspect = (collection: string, entryId: string) => {
    if (!transfer) return
    const id = transfer.id
    void run(async (mine) => {
      const entry = await api.preparedTransfers.entry(url, apiKey, destination, id, collection, entryId)
      if (mine === ticket.current) setInspected(entry)
    }, async (caught) => say(caught))
  }

  return {
    transfer,
    phase,
    busy,
    error,
    redo,
    inspected,
    /** A preparation this server has named, or a plan not yet applied. */
    cancellable: !!held && (busy ? phase === 'fetch' || phase === 'verify' || phase === 'plan' : transfer?.state === 'prepared'),
    prepare,
    page,
    apply,
    inspect,
    clearInspected: () => setInspected(null),
    discard: reset,
  }
}
