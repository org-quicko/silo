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
 */
export function useSourceKey(url: string, key: string, enabled: boolean): SourceKeyStatus {
  const [status, setStatus] = useState<SourceKeyStatus>('waiting')

  useEffect(() => {
    if (!enabled || !url || !key) {
      setStatus('waiting')
      return
    }
    setStatus('checking')
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const verified = await api.session.verify(url, key)
        if (active) setStatus(verified.ok ? 'ready' : 'refused')
      } catch {
        if (active) setStatus('unreachable')
      }
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [url, key, enabled])

  return status
}
