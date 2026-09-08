/** What a page's changes reach: the instance, one project or environment, or
 *  only this browser. */
export type Scope =
  | { kind: 'server' }
  | { kind: 'browser' }
  | { kind: 'project'; project: string }
  | { kind: 'env'; project: string; env: string }

/**
 * Blast radius as a word or two, for the title's own tooltip.
 *
 * This used to render as a chip beside the title on every settings page — a
 * repeat of the same word column-for-column down the nav. A page already
 * carries its scope in the breadcrumb above it and the nav item it comes from,
 * so the chip was saying a fourth time what the reader already knew from
 * getting there; the tooltip keeps the fact reachable without stating it
 * outright.
 */
export class ScopeDescription {
  static of(scope: Scope): string {
    switch (scope.kind) {
      case 'server':
        return 'Server-wide'
      case 'browser':
        return 'This browser only'
      case 'project':
        return `Scoped to ${scope.project}`
      case 'env':
        return `Scoped to ${scope.project}/${scope.env}`
    }
  }
}
