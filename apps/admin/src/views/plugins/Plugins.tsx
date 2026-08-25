import { useState } from 'react'
import { ChevronRight, Plug, PlugZap, RefreshCw } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { Link } from '../../router/Link'
import { Routes } from '../../router/routes'
import type { PluginView } from '../../api/types/plugin-view'
import type { RescanReport } from '../../api/types/rescan-report'
import type { ScopeRef } from '../../api/types/scope-ref'
import { TopBar } from '../shell/TopBar'
import { SmartSearch } from '../search/SmartSearch'
import type { PaletteSeed } from '../search/palette-seed'
import type { SessionBadge } from '../shell/session-badge'
import { PluginGrantPlan } from './plugin-grant-plan'
import { PluginRuntimePill } from './PluginRuntimePill'
import { PluginContributionWords } from './plugin-contribution-words'
import { PluginStatePill } from './PluginStatePill'
import { RescanResult } from './RescanResult'
import { usePlugins } from './use-plugins'
import table from '../../components/data/DataTable.module.css'
import styles from './Plugins.module.css'

/**
 * How many of a plugin's requests have been decided — the one number that says
 * whether anything is waiting on the operator.
 *
 * Counted from `requested` against `effective` rather than from the server's
 * `not_granted`, which is an exact set difference and therefore counts a
 * *narrowed* grant as ungranted. Both are true statements; only one of them
 * answers "is there a decision outstanding here".
 */
function GrantSummary({ plugin }: { plugin: PluginView }) {
  if (plugin.requested.length === 0) return <Pill>asks for nothing</Pill>
  const held = PluginGrantPlan.answered(plugin)
  const tone = held === 0 ? 'warn' : held === plugin.requested.length ? 'ok' : 'muted'
  return (
    <Pill tone={tone} title={plugin.effective.join('\n') || 'nothing granted'}>
      {held} of {plugin.requested.length} claims
    </Pill>
  )
}

/**
 * Installed plugins, what each is allowed to do, and what each is doing
 * (D40, phase 5).
 *
 * The list answers the question an operator opens it with — *is anything
 * waiting on me, and is anything broken* — and every decision happens one level
 * down, on the plugin's own page. Nothing here writes a grant.
 */
export function PluginsView({
  serverId,
  url,
  apiKey,
  scope,
  smartCollections,
  claims,
  session,
  onOpenPalette,
  onNavigateToCollection,
}: {
  serverId: string
  url: string
  apiKey: string
  scope: ScopeRef | null
  smartCollections: readonly { name: string; count: number | null; schema?: any }[]
  claims: string[]
  session: SessionBadge
  onOpenPalette: (seed: PaletteSeed) => void
  onNavigateToCollection: (name: string, q: string) => void
}) {
  const { plugins, loading, error, reload } = usePlugins(url, apiKey)
  const [report, setReport] = useState<RescanReport | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [rescanError, setRescanError] = useState('')

  const canRescan = Claims.has(claims, Claims.PluginsEnable)
  // Wide enough for the longest pill in each column: a clipped "Awaiting
  // approval" reads as a different, shorter status.
  const gridCols = '1.4fr 1.2fr 1fr 1fr 36px'

  const rescan = async () => {
    setRescanning(true)
    setRescanError('')
    try {
      setReport(await api.plugins.rescan(url, apiKey))
      await reload()
    } catch (caught: any) {
      setReport(null)
      setRescanError(caught.message || 'Rescan failed.')
    } finally {
      setRescanning(false)
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
        {canRescan && (
          <Button variant="secondary" onClick={rescan} disabled={rescanning}>
            <RefreshCw size={14} /> {rescanning ? 'Re-reading…' : 'Re-read silo.toml'}
          </Button>
        )}
      </TopBar>

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Admin' }, { label: 'Plugins' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Plugins</h2>
            <span className="page-sub">
              Which plugins load is <code>silo.toml</code>. What each may do is a grant held here,
              and withdrawing one takes effect immediately.
            </span>
          </div>
        </div>

        {error && (
          <div className="banner banner-bad">
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={reload}>Retry</Button>
          </div>
        )}
        {rescanError && <div className="banner banner-bad"><span>{rescanError}</span></div>}
        {report && <RescanResult report={report} onDismiss={() => setReport(null)} />}

        <div className="card">
          <div className={`${table.header} ${table.table}`} style={{ ['--cols' as any]: gridCols }}>
            <span>Plugin</span><span>Authority</span><span>Granted</span><span>Runtime</span><span />
          </div>

          {plugins.map((plugin) => (
            <Link
              key={plugin.name}
              to={Routes.plugin(serverId, plugin.name)}
              className={`${table.row} ${table.clickable} ${styles.row}`}
              style={{ ['--cols' as any]: gridCols }}
            >
              <div className={`${table.cell} ${styles.nameCell}`}>
                <span className={styles.avatar}>
                  {PluginContributionWords.runsInWorker(plugin.contributes) ? (
                    <Plug size={13} />
                  ) : (
                    <PlugZap size={13} />
                  )}
                </span>
                <span className={styles.nameGroup}>
                  <span className={styles.name}>{plugin.name}</span>
                  <span className={styles.kind}>
                    {PluginContributionWords.label(plugin.contributes)}
                    {plugin.enabled ? '' : ' · disabled'}
                  </span>
                </span>
              </div>
              <div className={table.cell}><PluginStatePill state={plugin.state} /></div>
              <div className={table.cell}><GrantSummary plugin={plugin} /></div>
              <div className={table.cell}><PluginRuntimePill runtime={plugin.runtime} /></div>
              <div className={`${table.cell} ${styles.chevron}`}><ChevronRight size={14} /></div>
            </Link>
          ))}

          {!loading && !error && plugins.length === 0 && (
            <div className={styles.empty}>
              <Plug size={22} />
              <span>No plugin has a record on this instance.</span>
              <span className={styles.emptyHint}>
                A record is written the first time a plugin listed in <code>silo.toml</code> loads.
                Install one with <code>silo add</code>, list it, then re-read the file.
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
