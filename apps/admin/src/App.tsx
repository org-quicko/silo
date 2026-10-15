import { useCallback, useEffect, useState } from 'react'
import { api } from './api/silo-api'
import { ToastHost } from './components/feedback/ToastHost'
import { Routes } from './router/routes'
import { router, useLocation, useRoute } from './router/router'
import { useDocumentTitle } from './router/use-document-title'
import { store } from './store/store'
import { ScopeMemory } from './utils/scope-memory'
import { ServerManager } from './views/servers/ServerManager'
import type { Server } from './views/servers/server'
import { SettingsView } from './views/settings/SettingsView'
import { ShortcutsHost } from './views/shell/ShortcutsHost'
import { Workspace } from './views/Workspace'

const SERVERS_KEY = 'silo_servers'
const ACTIVE_KEY = 'silo_active_server_id'

export default function App() {
  const location = useLocation()
  const route = useRoute()

  const [servers, setServers] = useState<Server[]>(() => {
    const stored = localStorage.getItem(SERVERS_KEY)
    return stored ? JSON.parse(stored) : []
  })

  const serverId = route && route.view !== 'servers' ? route.serverId : null
  const server = servers.find((s) => s.id === serverId) ?? null

  useDocumentTitle(route, server?.name ?? null)

  // The store is emptied on the way out: the next key to hold these cache
  // entries may be a different one, and a key's claims decide what its answers
  // contain.
  const disconnect = useCallback(() => {
    localStorage.removeItem(ACTIVE_KEY)
    store.clear()
    router.navigate(Routes.servers())
  }, [])

  // A stored key can be revoked out from under an open session; a 401 on any
  // authenticated call routes the app back to the welcome gate.
  useEffect(() => {
    api.setUnauthorizedHandler(disconnect)
    return () => api.setUnauthorizedHandler(null)
  }, [disconnect])

  // Resolve "/" (and anything unparseable) to /servers, and drop
  // links pointing at a server this browser no longer knows about. A URL from
  // before settings were split by scope is rewritten to its replacement first,
  // so an old bookmark lands on the right page rather than the gate.
  useEffect(() => {
    const legacy = Routes.legacy(location, (id) => ScopeMemory.get(id))
    if (legacy) {
      router.navigate(legacy, { replace: true })
      return
    }
    if (route === null) {
      router.navigate(Routes.servers(), { replace: true })
      return
    }
    if (route.view !== 'servers' && !server) {
      router.navigate(Routes.servers(), { replace: true })
    }
  }, [location, route, server, servers])

  // Remembered only so a bare "/" can resolve; the URL is the source of truth.
  useEffect(() => {
    if (server) localStorage.setItem(ACTIVE_KEY, server.id)
  }, [server])

  const saveServers = (list: Server[]) => {
    setServers(list)
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list))
  }

  const updateServer = (next: Server) => {
    const previous = servers.find((item) => item.id === next.id)
    // A new API key sees a different instance: its claims decide what every
    // answer contains, so nothing cached under the old one may outlive it.
    if (previous && previous.apiKey !== next.apiKey) store.clear()
    saveServers(servers.map((item) => (item.id === next.id ? next : item)))
  }

  const patchServer = (patch: Partial<Server>) => {
    if (server) updateServer({ ...server, ...patch })
  }

  /** Drops a saved connection from this browser; nothing on the instance changes. */
  const forgetServer = (id: string) => {
    saveServers(servers.filter((item) => item.id !== id))
    if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY)
    ScopeMemory.forget(id)
  }

  const content = !route || route.view === 'servers' || !server ? (
    <ServerManager
      servers={servers}
      onConnect={(id, project, env) => router.navigate(Routes.collections(id, project, env))}
      onAddServer={(s) => saveServers([...servers, s])}
      onUpdateServer={updateServer}
      onForgetServer={forgetServer}
      onOpenStatus={(id) => router.navigate(Routes.serverSettings(id, 'connection'))}
      onOpenProjectSettings={(id, project) =>
        router.navigate(Routes.projectSettings(id, project, 'general'))
      }
      onOpenEnvSettings={(id, project, env) =>
        router.navigate(Routes.envSettings(id, project, env, 'general'))
      }
    />
  ) : route.view === 'server-settings' || route.view === 'project-settings' || route.view === 'env-settings' ? (
    <SettingsView
      server={server}
      servers={servers}
      route={route}
      onUpdateServer={patchServer}
      onDeleteServer={() => {
        forgetServer(server.id)
        router.navigate(Routes.servers())
      }}
      onBack={() => router.navigate(Routes.servers())}
    />
  ) : (
    <Workspace
      key={`${server.id}:${'project' in route ? `${route.project}/${route.env}` : 'media'}`}
      server={server}
      servers={servers}
      route={route}
      onDisconnect={disconnect}
      onApiKeyChange={(apiKey) => patchServer({ apiKey })}
      onAddServer={(s) => saveServers([...servers, s])}
      onUpdateServer={updateServer}
      onForgetServer={forgetServer}
    />
  )

  return (
    <>
      {content}
      <ToastHost />
      <ShortcutsHost />
    </>
  )
}
