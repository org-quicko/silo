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
          {/* Short on purpose: pausing and un-approving being different
              decisions is the *reason* this control is separate from the grant,
              not something an operator has to read to use it. */}
          <span>Off keeps its claims and its key. It starts again when you turn it back on.</span>
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
            Acting as managed key <code>{plugin.key_id}</code>. silo holds the secret and rotates it
            on restart.
          </span>
        </div>
      )}
    </section>
  )
}
