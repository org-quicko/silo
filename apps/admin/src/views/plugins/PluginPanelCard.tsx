import { useEffect, useState } from 'react'
import { LayoutTemplate, TriangleAlert } from 'lucide-react'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import type { PluginPanelSource, PluginView } from '../../api/types/plugin-view'
import { PluginPanelFrame } from './panel/PluginPanelFrame'
import styles from './PluginDetail.module.css'

/**
 * The card a plugin's own panel lives in (D41).
 *
 * Placed **after** the grant and the routes and before the config, which is the
 * same argument D40 made for leading with hook delivery: a panel is a screen for
 * spending whatever this plugin was granted, so an operator scrolling to it has
 * already read what that is. Putting it at the top would make the interesting
 * thing on the page the plugin's own UI rather than the decision about it.
 *
 * The panel is not fetched until it is opened. It is markup a third party wrote,
 * it is measured in kilobytes rather than bytes, and an operator who came here to
 * revoke a grant should not have the package's own screen render itself on the
 * way — a `needs_review` plugin is exactly the case where that is least welcome.
 */
export function PluginPanelCard({
  plugin,
  url,
  apiKey,
  scope,
}: {
  plugin: PluginView
  url: string
  apiKey: string
  scope: { project: string; env: string } | null
}) {
  const ui = plugin.contributes?.ui
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<PluginPanelSource | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || panel || loading) return
    setLoading(true)
    setError('')
    api.plugins
      .panel(url, apiKey, plugin.name)
      .then(setPanel)
      .catch((caught: any) => setError(caught?.message || 'The panel could not be read.'))
      .finally(() => setLoading(false))
  }, [open, panel, loading, url, apiKey, plugin.name])

  if (!ui) return null

  const serving = plugin.runtime.state === 'running'

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.sectionTitle}>
          <LayoutTemplate size={15} />
          <h2>{ui.title || 'Panel'}</h2>
        </div>
        <p>
          This package ships its own screen, <code>{ui.entry}</code>. It runs in a sandboxed frame
          with no origin of its own — it cannot read this app’s stored keys, and the only thing it
          can do is ask the admin to call <code>/api/ext/{plugin.name}/…</code> with{' '}
          <b>your</b> key. Everything it does there, it does as you.
        </p>
      </div>

      {!serving && open && (
        <div className={styles.note}>
          <b>
            <TriangleAlert size={13} /> This plugin is not running.
          </b>
          <span>
            The panel will render, and every request it makes will fail — {plugin.runtime.detail || 'the worker is not up'}.
          </span>
        </div>
      )}

      {error && (
        <div className="banner banner-bad">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => setPanel(null)}>
            Retry
          </Button>
        </div>
      )}

      {!open && (
        <div className={styles.cardActions}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open panel
          </Button>
        </div>
      )}

      {open && loading && <p className={styles.empty}>Loading the panel…</p>}

      {open && panel && (
        <PluginPanelFrame
          plugin={plugin.name}
          url={url}
          apiKey={apiKey}
          panel={panel}
          scope={scope}
        />
      )}
    </section>
  )
}
