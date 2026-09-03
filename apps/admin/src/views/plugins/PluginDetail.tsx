import { useMemo, useState } from 'react'
import { LoadingState } from '../../components/feedback/LoadingState'
import { History, RotateCw, Route as RouteIcon, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { Sheet } from '../../components/modal/Sheet'
import { Routes } from '../../router/routes'
import { router } from '../../router/router'
import { ScopeMemory } from '../../utils/scope-memory'
import type { PluginView } from '../../api/types/plugin-view'
import { TopBar } from '../shell/TopBar'
import { PluginActivitySection } from './PluginActivitySection'
import { PluginConfigSection } from './PluginConfigSection'
import { PluginGrantSection } from './PluginGrantSection'
import { PluginPanelCard } from './PluginPanelCard'
import { PluginContributionWords } from './plugin-contribution-words'
import { PluginGrantPlan } from './plugin-grant-plan'
import { PluginLifecycleCard } from './PluginLifecycleCard'
import { PluginRoutesSection } from './PluginRoutesSection'
import { PluginRuntimePill } from './PluginRuntimePill'
import { PluginSectionButton } from './PluginSectionButton'
import { PluginStatePill } from './PluginStatePill'
import { UninstallPluginModal } from './UninstallPluginModal'
import { usePlugin } from './use-plugin'
import styles from './PluginDetail.module.css'

/** Which section is open, or none. One at a time: they are sheets over the same
 *  page, and two of them would be a stack nothing closes in order. */
type OpenSection = 'grant' | 'routes' | 'config' | 'activity' | null

/**
 * One plugin: its grant, its configuration, what has been decided about it, and
 * its own screen (D40 phase 5, D41, D44).
 *
 * Every action on this page is live. That is the whole of what phase 4 bought
 * and what makes a UI worth building on top of it: before the supervisor, each
 * of these buttons would have had to end in "restart the server to find out",
 * which is not a management surface but a form for editing a file badly.
 *
 * **The four sections are closed by default (D44).** Open, they were four long
 * lists — up to forty claims, eleven routes, a generated form and an audit trail
 * — stacked above the one thing on this page that needs room, and an operator
 * arriving to do anything scrolled first. What is kept on the page is each
 * section's *state*, in the button that opens it, because D40's property is that
 * this page answers "is anything waiting on me" without being opened. The
 * decision moved behind a click; the fact that there is one to make did not.
 */
export function PluginDetailView({
  serverId,
  name,
  url,
  apiKey,
  projects,
  claims,
}: {
  serverId: string
  name: string
  url: string
  apiKey: string
  projects: string[]
  claims: string[]
}) {
  const { plugin, loading, error, apply, reload } = usePlugin(url, apiKey, name)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [open, setOpen] = useState<OpenSection>(null)
  const [uninstalling, setUninstalling] = useState(false)

  const canGrant = Claims.has(claims, Claims.PluginsGrant)
  const canEnable = Claims.has(claims, Claims.PluginsEnable)
  const canConfigure = Claims.has(claims, Claims.PluginsConfigure)
  const canReadAudit = Claims.has(claims, Claims.AuditRead)
  const back = Routes.serverSettings(serverId, 'plugins')

  /**
   * The scope a panel is told the operator is working in (D41).
   *
   * From `ScopeMemory` rather than the route, because this page is deliberately
   * unscoped — a plugin's grant belongs to the instance — so there is no project
   * in the URL to read. It is a **hint** and nothing rests on it: a panel that
   * needs to know which scopes exist asks its own plugin, which can see them
   * through `ctx.projects`. Passing the operator's last-used scope only saves
   * them re-picking it in a form.
   *
   * Memoised because it is a fresh object on every call and it is a `useMemo`
   * dependency of the panel's `srcdoc` — a new identity per render would have
   * the panel document rebuilt for every keystroke elsewhere on the page.
   */
  const scope = useMemo(() => ScopeMemory.get(serverId), [serverId])

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

  const routes = plugin?.contributes?.routes ?? []
  const publicRoutes = routes.filter((route) => route.auth === 'public').length
  // The same two numbers the sheet computes, so the button and the section it
  // opens cannot disagree about whether something is outstanding. `held`
  // counts a *narrowed* answer as answered — deciding to allow less is still
  // deciding, and nagging the operator who was careful is the one thing this
  // summary must not do.
  const held = plugin ? PluginGrantPlan.heldRequested(plugin) : []
  const unmet = plugin ? plugin.required.filter((claim) => !held.includes(claim)) : []

  return (
    <>
      <TopBar>
        {plugin && canEnable && PluginContributionWords.runsInWorker(plugin.contributes) && (
          <Button
            variant="secondary"
            disabled={busy || !plugin.enabled}
            title={
              plugin.enabled
                ? 'Tear the worker down and bring it back'
                : 'Disabled. Enable it first.'
            }
            onClick={restart}
          >
            <RotateCw size={14} /> Restart
          </Button>
        )}
        {plugin && canEnable && (
          <Button
            variant="dangerGhost"
            disabled={busy}
            title="Take it off this instance: listing, grant, key and package"
            onClick={() => setUninstalling(true)}
          >
            <Trash2 size={14} /> Uninstall
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
        {loading && !plugin && <LoadingState message="Loading the plugin…" />}

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

            <div className={styles.sections}>
              <PluginSectionButton
                icon={<ShieldCheck size={15} />}
                title="Permissions"
                summary="What it may do, and what it asked for."
                status={
                  plugin.requested.length === 0
                    ? 'asks for nothing'
                    : `${held.length} of ${plugin.requested.length} claims`
                }
                tone={
                  plugin.state === 'needs_review' || unmet.length > 0
                    ? 'warn'
                    : held.length === plugin.requested.length && plugin.requested.length > 0
                      ? 'ok'
                      : 'muted'
                }
                onOpen={() => setOpen('grant')}
              />

              {routes.length > 0 && (
                <PluginSectionButton
                  icon={<RouteIcon size={15} />}
                  title="Routes"
                  summary="Served with this plugin’s authority, not the caller’s."
                  status={
                    publicRoutes > 0
                      ? `${routes.length} routes · ${publicRoutes} public`
                      : `${routes.length} routes`
                  }
                  tone={publicRoutes > 0 ? 'warn' : 'muted'}
                  onOpen={() => setOpen('routes')}
                />
              )}

              <PluginSectionButton
                icon={<SlidersHorizontal size={15} />}
                title="Configuration"
                summary="What it is configured with, and where that comes from."
                status={plugin.config_source === 'store' ? 'overridden here' : 'from silo.toml'}
                tone={plugin.config_source === 'store' ? 'warn' : 'muted'}
                onOpen={() => setOpen('config')}
              />

              {canReadAudit && (
                <PluginSectionButton
                  icon={<History size={15} />}
                  title="Activity"
                  summary="Who changed what, and when."
                  status="audit trail"
                  onOpen={() => setOpen('activity')}
                />
              )}
            </div>

            <PluginPanelCard plugin={plugin} url={url} apiKey={apiKey} scope={scope} />
          </>
        )}
      </div>

      {plugin && open === 'grant' && (
        <Sheet
          title="Permissions"
          subtitle="Everything this plugin may do, and the reason its author gave for each."
          icon={<ShieldCheck size={15} />}
          width="lg"
          onClose={() => setOpen(null)}
        >
          <PluginGrantSection
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
        </Sheet>
      )}

      {plugin && open === 'routes' && (
        <Sheet
          title="Routes"
          subtitle="One claim opens all of them, so this list is where that decision has any detail."
          icon={<RouteIcon size={15} />}
          width="lg"
          onClose={() => setOpen(null)}
        >
          <PluginRoutesSection plugin={plugin} />
        </Sheet>
      )}

      {plugin && open === 'config' && (
        <Sheet
          title="Configuration"
          subtitle={
            plugin.config_source === 'store'
              ? 'A stored override is in force, replacing this plugin’s silo.toml block.'
              : 'From this plugin’s block in silo.toml.'
          }
          icon={<SlidersHorizontal size={15} />}
          width="lg"
          onClose={() => setOpen(null)}
        >
          <PluginConfigSection
            key={`config-${plugin.rev}`}
            plugin={plugin}
            canConfigure={canConfigure}
            busy={busy}
            onSave={(patch) =>
              run(() => api.plugins.configure(url, apiKey, plugin.name, plugin.rev, patch))
            }
            onClear={() => run(() => api.plugins.clearConfig(url, apiKey, plugin.name, plugin.rev))}
          />
        </Sheet>
      )}

      {plugin && open === 'activity' && canReadAudit && (
        <Sheet
          title="Activity"
          subtitle="Authority decisions about this plugin, newest first. Changes made with the offline CLI are in here too."
          icon={<History size={15} />}
          onClose={() => setOpen(null)}
        >
          <PluginActivitySection url={url} apiKey={apiKey} name={plugin.name} rev={plugin.rev} />
        </Sheet>
      )}

      {plugin && uninstalling && (
        <UninstallPluginModal
          plugin={plugin}
          url={url}
          apiKey={apiKey}
          onCancel={() => setUninstalling(false)}
          // Back to the list, which is the only page left that can describe
          // what happened: this one is about a plugin that no longer exists.
          onDone={() => router.navigate(back)}
        />
      )}
    </>
  )
}
