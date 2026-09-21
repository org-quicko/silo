/** One collection of one environment, and how much it holds. */
export interface TransferTreeCollection {
  name: string
  entries: number
}

export interface TransferTreeEnv {
  name: string
  collections: TransferTreeCollection[]
}

export interface TransferTreeProject {
  name: string
  envs: TransferTreeEnv[]
}

/**
 * Everything an instance-wide transfer could carry, as the picker draws it.
 *
 * Assembled by walking projects then environments then collections, because a
 * transfer is instance-wide and every listing silo has is scoped. The same walk
 * answers what the whole archive would contain, so the totals below are derived
 * from it rather than counted a second time.
 */
export interface TransferTree {
  projects: TransferTreeProject[]
  /** Files in the library. One for the instance, not per scope. */
  media: number
  /** True when a scope refused to list, so the totals are a floor. */
  partial: boolean
}

export class TransferTrees {
  static entries(tree: TransferTree): number {
    return tree.projects.reduce(
      (total, project) =>
        total +
        project.envs.reduce(
          (perProject, env) =>
            perProject + env.collections.reduce((perEnv, item) => perEnv + item.entries, 0),
          0,
        ),
      0,
    )
  }

  /** Distinct collection names across the instance. The same name in two
   *  environments is one name and two collections; this counts names. */
  static collectionNames(tree: TransferTree): string[] {
    const names = new Set<string>()
    for (const project of tree.projects) {
      for (const env of project.envs) {
        for (const collection of env.collections) names.add(collection.name)
      }
    }
    return [...names].sort()
  }

  static scopes(tree: TransferTree): number {
    return tree.projects.reduce((total, project) => total + project.envs.length, 0)
  }
}
