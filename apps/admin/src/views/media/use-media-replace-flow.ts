import { useRef, useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaUsage } from '../../api/types/media-usage'
import type { MediaInUseAsset } from './media-delete-outcome'
import type { WriteOutcome } from './use-media-library'

/** What `usageOf` answers with — the shape `GET /api/media/:id/usages`
 *  returns, before it is folded into the referrer facts the gate reads. */
interface UsagePage {
  items: MediaUsage[]
  total: number
  visible: number
  visible_capped: boolean
}

/**
 * Drives the Replace dialog (D67).
 *
 * One dialog, not the confirm-then-in-use pair `useMediaDeleteFlow` runs.
 * The difference is that a delete is *refused* when something references the
 * asset and then offers a force, while a replace is never refused for that
 * reason: being referenced is the ordinary case and the whole point. So the
 * referrers are fetched **up front**, to decide whether the action may be
 * offered at all (`MediaContentAvailability`) and to say how far it reaches
 * before it is taken, rather than after.
 *
 * An unreferenced asset skips the fetch. Its reach is empty, which is exactly
 * what the server's own gate concludes, so a request whose answer cannot
 * change the outcome is not worth making.
 *
 * `referrers` stays `null` while loading, and the dialog waits: offering
 * Replace before the facts are in would arm a button the gate might refuse.
 */
export function useMediaReplaceFlow(
  usageOf: (id: string) => Promise<UsagePage | null>,
  replaceContent: (id: string, file: File) => Promise<WriteOutcome>,
  onReplaced?: (asset: MediaAsset) => void,
) {
  const [asset, setAsset] = useState<MediaAsset | null>(null)
  const [referrers, setReferrers] = useState<MediaInUseAsset | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Which load the dialog is currently waiting on. Opening Replace on a
   *  second file, or closing, retires whatever the first one had in flight —
   *  an answer about a file nobody is looking at must not land in the dialog
   *  that replaced it. */
  const ticket = useRef(0)

  const start = async (subject: MediaAsset) => {
    const mine = ++ticket.current
    setAsset(subject)
    setReferrers(null)
    setError('')

    if ((subject.usage_count || 0) === 0) {
      setReferrers(emptyReferrers(subject))
      return
    }

    setLoading(true)
    const page = await usageOf(subject.id)
    if (ticket.current !== mine) return
    setReferrers(page ? toReferrers(subject, page) : unreadableReferrers(subject))
    setLoading(false)
  }

  const cancel = () => {
    ticket.current++
    setAsset(null)
    setReferrers(null)
    setLoading(false)
    setError('')
  }

  const confirm = async (file: File) => {
    if (!asset) return
    setBusy(true)
    setError('')
    try {
      const failure = await replaceContent(asset.id, file)
      if (failure) {
        setError(failure)
        return
      }
      onReplaced?.(asset)
      cancel()
    } finally {
      setBusy(false)
    }
  }

  return { asset, referrers, loading, busy, error, start, cancel, confirm }
}

function emptyReferrers(asset: MediaAsset): MediaInUseAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    usage_count: 0,
    visible_count: 0,
    visible_capped: false,
    referrers: [],
  }
}

function toReferrers(asset: MediaAsset, page: UsagePage): MediaInUseAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    usage_count: page.total,
    visible_count: page.visible,
    visible_capped: page.visible_capped,
    referrers: page.items,
  }
}

/** The usage read failed, so nothing is known about the reach. Reported as a
 *  total nobody can see, which is the one shape the gate refuses on every
 *  branch — the safe reading of "we could not find out". */
function unreadableReferrers(asset: MediaAsset): MediaInUseAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    usage_count: asset.usage_count || 1,
    visible_count: 0,
    visible_capped: false,
    referrers: [],
  }
}
