import { Pill } from '../../components/feedback/Pill'
import type { PluginStatus } from '../../api/types/plugin-status'

const RUNTIME_TEXT: Record<PluginStatus['state'], string> = {
  running: 'Running',
  stopped: 'Stopped',
  failed: 'Failed',
}

const RUNTIME_TONE: Record<PluginStatus['state'], 'ok' | 'muted' | 'bad'> = {
  running: 'ok',
  stopped: 'muted',
  failed: 'bad',
}

/**
 * What the plugin is *doing* (D39).
 *
 * A separate pill from the grant state rather than one merged status, because
 * the two are genuinely independent and merging them would have to pick a lie
 * for the case that matters: a granted, enabled plugin whose worker outlived its
 * dispatch budget is torn down and never respawned. `detail` is the sentence
 * saying why, and it is carried on the pill rather than left to a support
 * ticket.
 */
export function PluginRuntimePill({ runtime }: { runtime: PluginStatus }) {
  return (
    <Pill tone={RUNTIME_TONE[runtime.state]} dot title={runtime.detail ?? undefined}>
      {RUNTIME_TEXT[runtime.state]}
    </Pill>
  )
}
