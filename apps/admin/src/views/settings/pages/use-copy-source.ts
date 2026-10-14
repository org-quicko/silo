import { useEffect, useState } from 'react'
import { api } from '../../../api/silo-api'
import { HttpTransport } from '../../../api/transport/http-transport'
import type { Server } from '../../servers/server'

export type CopySourceMedia = 'referenced' | 'none'
export type CopySourceStatus = 'local' | 'waiting' | 'checking' | 'ready' | 'refused' | 'unreachable'

/** One empty list for every unchecked render, so effects keyed on it stay still. */
const NoNames: string[] = []

/**
 * Where an env copy reads from: this server, or another saved one (D109).
 *
 * Another server is read from the browser with a key pasted for this copy. The
 * key lives in this state only, never in the saved server list, and is checked
 * against the source's `/api/session` before anything reads with it, so a
 * wrong key is a message here rather than a 401 somewhere else. A check holds
 * for the URL and key it was made with, and is read only while both still
 * match, so an edited key has no endpoint from the render it is typed in.
 */
export function useCopySource(server: Server, servers: Server[], projects: string[]) {
  const [serverId, setServerId] = useState(server.id)
  const [key, setKey] = useState('')
  const [media, setMedia] = useState<CopySourceMedia>('referenced')
  const [checked, setChecked] = useState<{
    url: string
    key: string
    status: CopySourceStatus
    claims: string[]
    projects: string[]
  } | null>(null)

  // The same instance under another saved name is still this server, and a
  // copy within one instance belongs to the env copy route.
  const others = servers.filter(
    (item) => item.id !== server.id && HttpTransport.baseUrl(item.url) !== HttpTransport.baseUrl(server.url),
  )
  const remote = others.find((item) => item.id === serverId) ?? null
  const trimmed = key.trim()

  useEffect(() => {
    if (!remote || !trimmed) return
    const url = remote.url
    const answer = (status: CopySourceStatus, claims: string[] = [], listed: string[] = []) =>
      setChecked({ url, key: trimmed, status, claims, projects: listed })
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const verified = await api.session.verify(url, trimmed)
        if (!active) return
        if (!verified.ok || !verified.session) {
          answer('refused')
          return
        }
        const listed = await api.projects.list(url, trimmed).catch(() => [])
        if (active) answer('ready', verified.session.claims, listed.map((item) => item.name))
      } catch {
        if (active) answer('unreachable')
      }
    }, 400)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [remote?.url, trimmed])

  const current = remote && checked?.url === remote.url && checked.key === trimmed ? checked : null
  const status: CopySourceStatus = !remote ? 'local' : !trimmed ? 'waiting' : current ? current.status : 'checking'
  const ready = !remote || status === 'ready'
  return {
    servers: others,
    /** This server's id, the select's first option. */
    local: server.id,
    serverId: remote ? remote.id : server.id,
    remote,
    key,
    media,
    status,
    /** What source reads use: this server, or the other one with the pasted key once it checks out. */
    endpoint: !remote ? server : ready ? { ...remote, apiKey: trimmed } : null,
    /** The source key's claims; null on this server, whose claims the page already holds. */
    claims: remote ? (current?.claims ?? NoNames) : null,
    projects: remote ? (current?.projects ?? NoNames) : projects,
    setServerId: (id: string) => {
      setServerId(id)
      setKey('')
    },
    setKey,
    setMedia,
  }
}
