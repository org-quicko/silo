import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
import './styles/forms.css'
import './styles/layout.css'
import './styles/feedback.css'
import './styles/utilities.css'
import { Routes } from './router/routes'
import { ScopeMemory } from './utils/scope-memory'
import { ThemeManager } from './utils/theme-manager'
import { ServerStorage } from './views/servers/server'
import App from './App.tsx'
import { ErrorBoundary } from './components/feedback/ErrorBoundary'

const savedServers = ServerStorage.read()

function resolveInitialServerId(): string | null {
  const location = window.location.pathname + window.location.search
  const { route } = Routes.resolve(location, (id) => ScopeMemory.get(id))
  if (!route || route.view === 'servers') return null
  return savedServers.some((s) => s.id === route.serverId) ? route.serverId : null
}

ThemeManager.init(
  resolveInitialServerId(),
  savedServers.map((s) => s.id),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
