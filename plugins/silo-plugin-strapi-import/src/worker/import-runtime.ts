import type { SiloContext, SiloRequest } from 'silo:api'
import { RunningTargets } from '../import/running-targets'
import type { ImportSession } from './import-session'
import { ImportSessions } from './import-sessions'
import { PluginSettings } from './plugin-settings'

/**
 * The state one worker holds, built at activation.
 *
 * A single live instance rather than a value threaded through every route,
 * because the routes are keys on one object silo calls and there is nowhere to
 * pass it: `activate` is the only place that runs before them.
 *
 * Everything about *one* import lives on an `ImportSession` instead, keyed by
 * the caller. What stays here is what is genuinely the worker's: the settings,
 * the map of sessions, the collections being written right now, and the janitor
 * that ends a session nobody came back to.
 */
export class ImportRuntime {
  private static live: ImportRuntime | null = null

  /** How often idle sessions are swept. Short enough that an abandoned upload
   *  goes the same day, long enough to be invisible. */
  private static readonly SweepEveryMs = 30 * 60 * 1000

  readonly settings: PluginSettings
  readonly sessions: ImportSessions
  readonly targets: RunningTargets

  private janitor: ReturnType<typeof setInterval> | null = null

  private constructor(settings: PluginSettings) {
    this.settings = settings
    this.sessions = new ImportSessions(settings)
    this.targets = new RunningTargets()
  }

  /**
   * Build the runtime, adopt the sessions staged before a restart, and start
   * the janitor.
   *
   * The recovery is the whole reason this plugin declares a runtime: without
   * it, restarting the worker — which the admin offers a button for — would
   * leave the panel reporting no source while a copy of the operator's database
   * sat in the staging directory.
   */
  static async start(ctx: SiloContext): Promise<ImportRuntime> {
    const runtime = new ImportRuntime(PluginSettings.read(ctx))
    ImportRuntime.live = runtime

    await runtime.sessions.recover(ctx)

    runtime.janitor = setInterval(() => {
      void runtime.sessions.sweep(ctx)
    }, ImportRuntime.SweepEveryMs)
    // Nothing should be kept alive by the sweep alone.
    ;(runtime.janitor as unknown as { unref?: () => void }).unref?.()

    return runtime
  }

  /** Forget the runtime and stop the janitor. Staged files are deliberately
   *  left on disk: a restart is not a decision to discard an operator's upload,
   *  and `DELETE /source` is where that decision is expressed. */
  static stop(): void {
    if (ImportRuntime.live?.janitor) clearInterval(ImportRuntime.live.janitor)
    ImportRuntime.live = null
  }

  static current(): ImportRuntime {
    if (!ImportRuntime.live) throw new Error('the plugin is not activated')
    return ImportRuntime.live
  }

  /** The caller's own session. Every route starts here. */
  session(request: SiloRequest): ImportSession {
    return this.sessions.of(request)
  }
}
