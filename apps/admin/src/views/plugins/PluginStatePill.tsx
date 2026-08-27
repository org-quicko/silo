import { Pill } from '../../components/feedback/Pill'
import type { PluginState } from '../../api/types/plugin-view'

/** What an operator decided about a plugin's authority (D34) — as distinct
 *  from what the plugin is doing, which is `PluginRuntimePill`. */
const STATE_TEXT: Record<PluginState, string> = {
  pending: 'Awaiting approval',
  granted: 'Granted',
  needs_review: 'Needs review',
  revoked: 'Revoked',
}

const STATE_TONE: Record<PluginState, 'ok' | 'warn' | 'muted'> = {
  pending: 'warn',
  granted: 'ok',
  needs_review: 'warn',
  revoked: 'muted',
}

const STATE_WHY: Record<PluginState, string> = {
  pending: 'Installed and loaded, approved for nothing, so it is running and doing nothing.',
  granted: 'Approved for exactly what its manifest asked for when it was approved.',
  needs_review:
    'An upgrade asked for more than it holds. The extra was not granted, and it keeps running on what it had.',
  revoked: 'Its stored grant was withdrawn. Claims written in silo.toml, if any, still apply.',
}

export function PluginStatePill({ state }: { state: PluginState }) {
  return (
    <Pill tone={STATE_TONE[state]} title={STATE_WHY[state]}>
      {STATE_TEXT[state]}
    </Pill>
  )
}
