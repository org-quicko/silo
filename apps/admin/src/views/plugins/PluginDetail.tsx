import { useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { Routes } from '../../router/routes'
import type { PluginView } from '../../api/types/plugin-view'
import type { ScopeRef } from '../../api/types/scope-ref'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import type { SessionBadge } from '../shell/session-badge'
import { PluginActivityCard } from './PluginActivityCard'
import { PluginConfigCard } from './PluginConfigCard'
import { PluginGrantCard } from './PluginGrantCard'
import { PluginContributionWords } from './plugin-contribution-words'
import { PluginLifecycleCard } from './PluginLifecycleCard'
import { PluginRoutesCard } from './PluginRoutesCard'
import { PluginRuntimePill } from './PluginRuntimePill'
import { PluginStatePill } from './PluginStatePill'
import { usePlugin } from './use-plugin'
import styles from './PluginDetail.module.css'

/**
 * One plugin: its grant, its configuration, and what has been decided about it
 * (D40, phase 5).
 *
 * Every action on this page is live. That is the whole of what phase 4 bought
 * and what makes a UI worth building on top of it: before the supervisor, each
 * of these buttons would have had to end in "restart the server to find out",
 * which is not a management surface but a form for editing a file badly.
 */
export function PluginDetailView({
  serverId,
  name,
  url,
  apiKey,
  scope,
  projects,
  smartCollections,
  claims,
  session,
  onOpenPalette,
  onNavigateToCollection,
}: {
  serverId: string
  name: string
  url: string
  apiKey: string
  scope: ScopeRef | null
  projects: string[]
  smartCollections: readonly { name: string; count: number | null; schema?: any }[]
  claims: string[]
  session: SessionBadge
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
}) {
  const { plugin, loading, error, apply, reload } = usePlugin(url, apiKey, name)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const canGrant = Claims.has(claims, Claims.PluginsGrant)
  const canEnable = Claims.has(claims, Claims.PluginsEnable)
  const canConfigure = Claims.has(claims, Claims.PluginsConfigure)
  const canReadAudit = Claims.has(claims, Claims.AuditRead)
  const back = Routes.serverSettings(serverId, 'plugins')

  /**
   * Run one mutation and install what it answers with.
   *
   * Every write returns the whole record, so the next `If-Match` comes from the
   * response rather than from a re-read — which is what keeps two changes in a
   * row from failing on a revision the page never saw.
   */
  const run = async (work: () => Promise<PluginView>) => {
    setBusy(true)
    setActionError('')
    try {
      apply(await work())
    } catch (caught: any) {
      setActionError(caught.message || 'That did not work.')
      // A refused `If-Match` means somebody else moved the record. Re-read, so
      // the next attempt is made against what is actually stored.
      if (caught?.status === 412 || caught?.status === 409) await reload()
    } finally {
      setBusy(false)
    }
  }

  const restart = async () => {
    setBusy(true)
    setActionError('')
    try {
      await api.plugins.restart(url, apiKey, name)
      await reload()
    } catch (caught: any) {
      setActionError(caught.message || 'Restart failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar
        search={
          <SmartSearch
            serverId={serverId}
            scope={scope}
            collection={null}
            collections={smartCollections}
            onNavigateToCollection={onNavigateToCollection}
            onOpenPalette={onOpenPalette}
          />
        }
        session={session}
      >
        {plugin && canEnable && PluginContributionWords.runsInWorker(plugin.contributes) && (
          <Button
            variant="secondary"
            disabled={busy || !plugin.enabled}
            title={
              plugin.enabled
                ? 'Tear the worker down and bring it back'
                : 'Disabled — enable it first'
            }
            onClick={restart}
          >
            <RotateCw size={14} /> Restart
          </Button>
        )}
      </TopBar>

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Admin' }, { label: 'Plugins', to: back }, { label: name }]} />

        {error && (
          <div className="banner banner-bad">
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={reload}>Retry</Button>
          </div>
        )}
        {actionError && <div className="banner banner-bad"><span>{actionError}</span></div>}
        {loading && !plugin && <div className={styles.empty}>Loading…</div>}

        {plugin && (
          <>
            <div className="page-head">
              <div className="page-title-group">
                <h2 className="page-title">{plugin.name}</h2>
                <span className="page-sub">
                  {PluginContributionWords.sentence(plugin.contributes)}
                </span>
              </div>
              <div className={styles.headPills}>
                <PluginStatePill state={plugin.state} />
                <PluginRuntimePill runtime={plugin.runtime} />
              </div>
            </div>

            {plugin.runtime.detail && plugin.runtime.state === 'failed' && (
              <div className="banner banner-bad">
                <span>{plugin.runtime.detail}</span>
              </div>
            )}

            <PluginLifecycleCard
              plugin={plugin}
              canEnable={canEnable}
              busy={busy}
              onSetEnabled={(on) =>
                run(() => api.plugins.setEnabled(url, apiKey, plugin.name, plugin.rev, on))
              }
            />

            <PluginGrantCard
              key={`grant-${plugin.rev}`}
              plugin={plugin}
              url={url}
              apiKey={apiKey}
              projects={projects}
              ownClaims={claims}
              canGrant={canGrant}
              busy={busy}
              onGrant={(granted) =>
                run(() => api.plugins.grant(url, apiKey, plugin.name, plugin.rev, granted))
              }
              onRevoke={() => run(() => api.plugins.revoke(url, apiKey, plugin.name, plugin.rev))}
            />

            <PluginRoutesCard plugin={plugin} />

            <PluginConfigCard
              key={`config-${plugin.rev}`}
              plugin={plugin}
              canConfigure={canConfigure}
              busy={busy}
              onSave={(patch) =>
                run(() => api.plugins.configure(url, apiKey, plugin.name, plugin.rev, patch))
              }
              onClear={() =>
                run(() => api.plugins.clearConfig(url, apiKey, plugin.name, plugin.rev))
              }
            />

            {canReadAudit && (
              <PluginActivityCard url={url} apiKey={apiKey} name={plugin.name} rev={plugin.rev} />
            )}
          </>
        )}
      </div>
    </>
  )
}
