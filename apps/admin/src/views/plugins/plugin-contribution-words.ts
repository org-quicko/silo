import type { PluginContributions } from '../../api/types/plugin-view'

/**
 * What a package contributes, in the words a page shows it in (D36).
 *
 * Its own artifact because three surfaces need the same three answers — the
 * listing's row label, the detail page's subtitle, and whether to offer a restart
 * at all — and each of them used to ask `kind === 'provider'`. That question had
 * one answer per package; this one has an answer per *contribution*, so a package
 * doing two things now reads as doing two things instead of as whichever the enum
 * happened to say.
 *
 * `null` means the package could not be read. Every answer here treats that as
 * "assume it behaves like an ordinary plugin", because the alternative is hiding
 * a control on a plugin that has one — and `runtime.detail` is already saying why
 * the package could not be read.
 */
export class PluginContributionWords {
  /** Whether there is a worker to restart, disable, or deliver hooks to. */
  static runsInWorker(contributes: PluginContributions | null): boolean {
    if (!contributes) return true
    return (
      contributes.hooks.length > 0 || contributes.routes.length > 0 || contributes.runtime
    )
  }

  /** The short label under a name in the listing. */
  static label(contributes: PluginContributions | null): string {
    if (!contributes) return 'unreadable package'
    const parts: string[] = []
    if (contributes.hooks.length > 0) parts.push('hooks')
    if (contributes.routes.length > 0) parts.push('routes')
    if (contributes.runtime) parts.push('runtime')
    if (contributes.providers.length > 0) parts.push('provider')
    return parts.length > 0 ? parts.join(' · ') : 'contributes nothing'
  }

  /** A sentence for the detail page, naming every contribution rather than the
   *  first one that matched. */
  static sentence(contributes: PluginContributions | null): string {
    if (!contributes) {
      return 'This package could not be read, so what it contributes is unknown.'
    }

    const parts: string[] = []
    if (contributes.hooks.length > 0) {
      parts.push(`attached to ${contributes.hooks.join(', ')}`)
    }
    if (contributes.routes.length > 0) {
      parts.push(`serving ${contributes.routes.length} route${contributes.routes.length === 1 ? '' : 's'}`)
    }
    if (contributes.runtime) parts.push('running code of its own on activation')
    for (const provider of contributes.providers) {
      parts.push(`providing the ${provider.port} driver “${provider.driver}”`)
    }

    if (parts.length === 0) return 'This package contributes nothing.'
    return `Contributes: ${PluginContributionWords.list(parts)}.`
  }

  /** `a`, `a and b`, `a, b and c` — an Oxford-free list, because these are
   *  phrases rather than nouns and a trailing comma reads as a fourth item. */
  private static list(parts: readonly string[]): string {
    if (parts.length === 1) return parts[0]!
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  }
}
