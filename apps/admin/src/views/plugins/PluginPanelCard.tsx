import { useEffect, useState } from 'react'
import { Maximize2, Minimize2, TriangleAlert } from 'lucide-react'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import type { PluginPanelSource, PluginView } from '../../api/types/plugin-view'
import { PluginPanelFrame } from './panel/PluginPanelFrame'
import styles from './PluginDetail.module.css'

/**
 * The card a plugin's own panel lives in (D41, reshaped by D44).
 *
 * It used to sit below the grant, the routes and the config, on the argument
 * that a panel is a screen for *spending* whatever the plugin was granted and an
 * operator should read the grant on the way past. The argument was right about
 * the order and wrong about the cost: four open sections above it left a
 * third-party screen a few hundred pixels tall at the bottom of a long scroll,
 * which is not enough room to do anything a panel exists to do. The sections are
 * sheets now, so the reading still comes first — it is one click, and the page
 * says what each of them holds — and the panel gets the page.
 *
 * It is still not fetched until it is opened. It is markup a third party wrote,
 * it is measured in kilobytes rather than bytes, and an operator who came here
 * to revoke a grant should not have the package's own screen render itself on
 * the way — a `needs_review` plugin is exactly the case where that is least
 * welcome.
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
  const [full, setFull] = useState(false)
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

  // Escape leaves the maximised state before it leaves the page, which is what
  // a full-screen overlay has to answer for taking the viewport.
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  if (!ui) return null

  const serving = plugin.runtime.state === 'running'

  return (
    <section className={`${styles.panelCard} ${full ? styles.panelFull : ''}`}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.sectionTitle}>
            <h2>{ui.title || 'Panel'}</h2>
          </div>
          {/* One line. The full argument — opaque origin, no access to this app's
              stored keys, the relay's namespace check — is in §10 of
              admin-ui.md and in the protocol module; repeating it here put four
              lines of security prose above the screen an operator came to use. */}
          <p>
            Sandboxed. It can only call this plugin’s own routes, with <b>your</b> key, as you.
          </p>
        </div>

        <div className={styles.panelHeadActions}>
          {open && panel && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFull(!full)}
              title={full ? 'Back to the page' : 'Give the panel the whole window'}
            >
              {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {full ? 'Exit full screen' : 'Full screen'}
            </Button>
          )}
          {!open && (
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Open panel
            </Button>
          )}
        </div>
      </div>

      {!serving && open && (
        <div className={styles.panelBody}>
          <div className={styles.note}>
            <b>
              <TriangleAlert size={13} /> This plugin is not running.
            </b>
            <span>
              The panel will render, and every request it makes will fail:{' '}
              {plugin.runtime.detail || 'the worker is not up'}.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className={styles.panelBody}>
          <div className="banner banner-bad">
            <span>{error}</span>
            <Button variant="secondary" size="sm" onClick={() => setPanel(null)}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {open && loading && <p className={styles.panelEmpty}>Loading the panel…</p>}

      {open && panel && (
        <div className={styles.panelStage}>
          <div className={styles.panelBody}>
            <PluginPanelFrame
              plugin={plugin.name}
              url={url}
              apiKey={apiKey}
              panel={panel}
              scope={scope}
              fill={full}
            />
          </div>
        </div>
      )}
    </section>
  )
}
