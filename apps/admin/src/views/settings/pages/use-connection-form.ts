import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../api/silo-api'
import type { Server } from '../../servers/server'

/** What a connection test found, or why it failed. */
export type ConnectionStatus = 'idle' | 'online' | 'error'

/** The facts the settings page shows about the live connection. */
export interface ConnectionFacts {
  version: string
  sessionLabel: string
  keyPrefix: string
  claims: string[]
}

/**
 * The editable connection — name, URL, key — plus the two things you can do
 * with it: test it, and save it.
 *
 * A save always verifies first: writing an unreachable server into the list is
 * how a workspace ends up unable to explain why nothing loads.
 */
export function useConnectionForm(
  server: Server,
  initial: ConnectionFacts,
  onUpdateServer: (patch: { name: string; url: string; apiKey: string }) => void,
) {
  const [name, setName] = useState(server.name)
  const [url, setUrl] = useState(server.url)
  const [apiKey, setApiKey] = useState(server.apiKey)

  const [facts, setFacts] = useState<ConnectionFacts>(initial)
  const [status, setStatus] = useState<ConnectionStatus>('online')
  const [statusMessage, setStatusMessage] = useState('')
  const [pingMs, setPingMs] = useState<number | null>(null)

  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // The shell resolves the session over its own round trip, so these arrive
  // after first paint and have to be adopted rather than read once.
  useEffect(() => {
    setFacts(initial)
  }, [initial.version, initial.sessionLabel, initial.keyPrefix, initial.claims])

  const test = async () => {
    setTesting(true)
    setStatus('idle')
    setStatusMessage('')

    const startedAt = performance.now()
    try {
      const [health, session] = await Promise.all([
        api.session.health(url.trim()),
        api.session.get(url.trim(), apiKey.trim()),
      ])
      setStatus('online')
      setPingMs(Math.round(performance.now() - startedAt))
      setFacts({
        version: health.version,
        sessionLabel: session.label,
        keyPrefix: session.prefix,
        claims: session.claims || [],
      })
    } catch (failure: any) {
      setStatus('error')
      setStatusMessage(failure.message || 'Connection failed')
    } finally {
      setTesting(false)
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSaved(false)

    const trimmedName = name.trim()
    const trimmedKey = apiKey.trim()
    let trimmedUrl = url.trim()
    if (!trimmedName || !trimmedUrl || !trimmedKey) {
      setError('Name, URL, and API Key are all required.')
      return
    }
    // A bare host is the common case; assume the unencrypted scheme rather
    // than failing on a URL the user plainly meant.
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      trimmedUrl = `http://${trimmedUrl}`
    }

    setSaving(true)
    try {
      const verified = await api.session.verify(trimmedUrl, trimmedKey)
      if (!verified.ok) {
        setError('Verification failed: Invalid API key.')
        return
      }
      onUpdateServer({ name: trimmedName, url: trimmedUrl, apiKey: trimmedKey })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (failure: any) {
      setError(`Verification failed: ${failure.message || 'Server unreachable'}`)
    } finally {
      setSaving(false)
    }
  }

  return {
    name,
    setName,
    url,
    setUrl,
    apiKey,
    setApiKey,
    facts,
    status,
    statusMessage,
    pingMs,
    testing,
    saving,
    saved,
    error,
    test,
    save,
  }
}
