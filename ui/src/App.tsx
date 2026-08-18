import { useCallback, useEffect, useState } from 'react'
import { api } from './api/api-client'
import { Routes } from './router/routes'
import { router, useRoute } from './router/router'
import { ServerManager } from './views/servers/ServerManager'
import type { Server } from './views/servers/server'
import { SettingsView } from './views/settings/SettingsView'
import { Workspace } from './views/Workspace'

const SERVERS_KEY = 'silo_servers'
const ACTIVE_KEY = 'silo_active_server_id'

export default function App() {
  const route = useRoute()

  const [servers, setServers] = useState<Server[]>(() => {
    const stored = localStorage.getItem(SERVERS_KEY)
    return stored ? JSON.parse(stored) : []
  })

  const serverId = route && route.view !== 'servers' ? route.serverId : null
  const server = servers.find((s) => s.id === serverId) ?? null

  const disconnect = useCallback(() => {
    localStorage.removeItem(ACTIVE_KEY)
    router.navigate(Routes.servers())
  }, [])

  // A stored key can be revoked out from under an open session; a 401 on any
  // authenticated call routes the app back to the welcome gate.
  useEffect(() => {
    api.setUnauthorizedHandler(disconnect)
    return () => api.setUnauthorizedHandler(null)
  }, [disconnect])

  // Resolve "/" (and anything unparseable) to /servers, and drop
  // links pointing at a server this browser no longer knows about.
  useEffect(() => {
    if (route === null) {
      router.navigate(Routes.servers(), { replace: true })
      return
    }
    if (route.view !== 'servers' && !server) {
      router.navigate(Routes.servers(), { replace: true })
    }
  }, [route, server, servers])

  // Remembered only so a bare "/" can resolve; the URL is the source of truth.
  useEffect(() => {
    if (server) localStorage.setItem(ACTIVE_KEY, server.id)
  }, [server])

  const saveServers = (list: Server[]) => {
    setServers(list)
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list))
  }

  const patchServer = (patch: Partial<Server>) => {
    if (!server) return
    saveServers(servers.map((item) => (item.id === server.id ? { ...item, ...patch } : item)))
  }

  if (!route || route.view === 'servers' || !server) {
    return (
      <ServerManager
        servers={servers}
        onConnect={(id, project, env) => router.navigate(Routes.collections(id, project, env))}
        onAddServer={(s) => saveServers([...servers, s])}
        onOpenStatus={(id) => router.navigate(Routes.settingsProjects(id))}
      />
    )
  }

  if (route.view === 'server-settings') {
    return (
      <SettingsView
        server={server}
        section={route.section}
        onUpdateServer={patchServer}
        onDeleteServer={() => {
          saveServers(servers.filter((s) => s.id !== server.id))
          if (localStorage.getItem(ACTIVE_KEY) === server.id) localStorage.removeItem(ACTIVE_KEY)
          router.navigate(Routes.servers())
        }}
        onBack={() => router.navigate(Routes.servers())}
      />
    )
  }

  return (
    <Workspace
      key={`${server.id}:${route.project}/${route.env}`}
      server={server}
      route={route}
      onDisconnect={disconnect}
      onApiKeyChange={(apiKey) => patchServer({ apiKey })}
    />
  )
}
