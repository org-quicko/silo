import type { SiloContext, SiloScope } from 'silo:api'

/** One project a plan could target, with the environments in it. */
export interface SiloTarget {
  id: string
  environments: string[]
}

/**
 * The projects and environments an import could be written into.
 *
 * Read from silo rather than configured, which is the point: where an import
 * goes is a decision made on the plan, against the scopes that actually exist,
 * and a `[plugins.config]` key naming one would be a second answer to the same
 * question — one the panel could disagree with and the operator could not see.
 *
 * Served by the plugin rather than read by the panel, because the panel has no
 * authority of its own: it can only reach this plugin's routes, and this plugin
 * holds the grant that can see them.
 */
export class SiloTargets {
  /**
   * Every project the grant can see, each with its environments.
   *
   * Two calls per project, because `ctx.projects.list()` answers project **ids**
   * and environments are a request of their own. A project whose environments
   * cannot be read is still listed with none: the grant may cover one project's
   * environments and not another's, and dropping the project would tell the
   * operator it does not exist.
   */
  static async list(ctx: SiloContext): Promise<SiloTarget[]> {
    const projects = await ctx.projects.list()
    const targets: SiloTarget[] = []
    for (const project of projects.items) {
      const id = SiloTargets.idOf(project)
      if (id.length > 0) targets.push({ id, environments: await SiloTargets.environments(ctx, id) })
    }
    return targets
  }

  /**
   * Where a plan points before anybody edits it: the first project, and its
   * first environment.
   *
   * Empty when the grant can see nothing. That is left to fail at
   * `ImportPlans.read`, which refuses by naming the field — better than
   * proposing a scope that does not exist because it is the one silo shipped
   * with.
   */
  static defaultOf(targets: readonly SiloTarget[]): SiloScope {
    const first = targets[0]
    return { project: first?.id ?? '', env: first?.environments[0] ?? '' }
  }

  private static async environments(ctx: SiloContext, project: string): Promise<string[]> {
    const response = await ctx.fetch(
      `/api/projects/${encodeURIComponent(project)}/environments`,
    )
    if (!response.ok) return []
    const items = response.json()?.items ?? []
    return items.map(SiloTargets.idOf).filter((id: string) => id.length > 0)
  }

  /**
   * The **name**, which is what a URL is built from.
   *
   * Since D51 a scope listing answers `{id, name}` where `id` is the record's
   * ULID, so preferring `id` — as this did — would put a ULID into
   * `/api/projects/<...>/environments` and 404 on every project. `name` first,
   * then `id`, then a bare string, so an older silo answering plain names still
   * works.
   */
  private static idOf(entry: unknown): string {
    if (typeof entry === 'string') return entry
    const record = entry as { id?: unknown; name?: unknown } | null
    return String(record?.name ?? record?.id ?? '')
  }
}
