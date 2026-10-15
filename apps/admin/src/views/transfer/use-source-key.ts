import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'

export type SourceKeyStatus = 'waiting' | 'checking' | 'ready' | 'refused' | 'unreachable'

/**
 * Whether the source accepts the key pasted for a copy.
 *
 * Asked of the source's `/api/session` before anything reads it, because every
 * other read goes through the shared transport, whose 401 handler disconnects
 * this server: a wrong source key would log the operator out rather than say
 * so. The same check as the env copy page's (D112).
 *
 * An answer holds for the URL and key it was asked with, and is read only
 * while both still match. An edited key is unchecked from the render it is
 * typed in, so no read goes out with it on the strength of the old answer.
 */
export function useSourceKey(url: string, key: string, enabled: boolean): SourceKeyStatus {
  const [checked, setChecked] = useState<{ url: string; key: string; status: SourceKeyStatus } | null>(null)

  useEffect(() => {
    if (!enabled || !url || !key) return
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const verified = await api.session.verify(url, key)
        if (active) setChecked({ url, key, status: verified.ok ? 'ready' : 'refused' })
      } catch {
        if (active) setChecked({ url, key, status: 'unreachable' })
      }
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [url, key, enabled])

  if (!enabled || !url || !key) return 'waiting'
  return checked?.url === url && checked.key === key ? checked.status : 'checking'
}
