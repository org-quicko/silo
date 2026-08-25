import { KeyRound } from 'lucide-react'
import { Toggle } from '../../components/controls/Toggle'
import type { PluginView } from '../../api/types/plugin-view'
import styles from './PluginDetail.module.css'

/**
 * Enabled or not, and the managed key that carries the grant.
 *
 * Separate from the grant card because the two are different decisions, which
 * is the whole reason `enabled` is orthogonal to `state`: pausing a plugin is
 * not un-approving it, and an operator who had to re-approve after every pause
 * would learn to approve widely to avoid the trouble.
 */
export function PluginLifecycleCard({
  plugin,
  canEnable,
  busy,
  onSetEnabled,
}: {
  plugin: PluginView
  canEnable: boolean
  busy: boolean
  onSetEnabled: (enabled: boolean) => void
}) {
  return (
    <section className={styles.card}>
      <div className={styles.enableRow}>
        <div>
          <b>{plugin.enabled ? 'Enabled' : 'Disabled'}</b>
          <span>
            Pausing a plugin is not the same decision as un-approving it: a disabled plugin keeps
            its claims and its key, and starts again the moment it is enabled.
          </span>
        </div>
        <Toggle
          on={plugin.enabled}
          disabled={!canEnable || busy}
          title={canEnable ? undefined : 'Needs the plugins:enable claim'}
          onChange={onSetEnabled}
        />
      </div>

      {plugin.key_id && (
        <div className={styles.keyRow}>
          <KeyRound size={13} />
          <span>
            Acting as managed key <code>{plugin.key_id}</code>. silo holds its secret and rotates it
            on restart, so the plugin never has a token to leak.
          </span>
        </div>
      )}
    </section>
  )
}
