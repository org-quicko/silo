import type { TransferTree } from './transfer-tree'

/**
 * The `project[/env[/collection]]` rules a transfer carries, and the tri-state
 * a tree of checkboxes needs to draw them.
 *
 * Immutable, like `ScopeCopySelection`: every method answers a new list. The
 * list is literal — an empty one is an empty selection, not the whole
 * instance. The server reads an absent `include` as the whole instance (§7.6),
 * and `wire` is the one place those two spellings meet: it collapses a
 * selection that already covers every project back to the empty list the route
 * expects. Keeping the screen literal is what lets a picker open with nothing
 * checked (D89).
 */
export class TransferInclude {
  /**
   * Checks or unchecks one box.
   *
   * The one entry point the picker uses, so every path through it ends in the
   * same shape: rules are added or subtracted, then rolled back up, so a box
   * whose children are all checked reads as checked rather than as partial.
   */
  static toggle(
    rules: readonly string[],
    rule: string,
    checked: boolean,
    tree: TransferTree,
  ): string[] {
    const next = checked
      ? TransferInclude.add(rules, rule)
      : TransferInclude.remove(rules, rule, tree)
    return TransferInclude.collapse(next, tree)
  }

  /**
   * Adds a rule and drops anything it now covers, so `site` replaces
   * `site/prod` rather than sitting beside it. Redundant rules are legal on the
   * wire but make the list unreadable.
   */
  static add(rules: readonly string[], rule: string): string[] {
    const covered = (candidate: string) => candidate === rule || candidate.startsWith(`${rule}/`)
    if (rules.some((existing) => rule.startsWith(`${existing}/`))) return [...rules]
    return [...rules.filter((existing) => !covered(existing)), rule].sort()
  }

  /**
   * Removes a rule, expanding a broader one that covered it.
   *
   * Unchecking `site/prod` under a chosen `site` has to leave the rest of
   * `site` chosen, so the broad rule is replaced by its siblings.
   */
  static remove(rules: readonly string[], rule: string, tree: TransferTree): string[] {
    const inside = (outer: string, inner: string) => inner.startsWith(`${outer}/`)
    // Everything unrelated to the rule. The broader ones are dropped here and
    // put back below as the siblings along the path down to it.
    const kept = new Set(
      rules.filter(
        (existing) => existing !== rule && !inside(rule, existing) && !inside(existing, rule),
      ),
    )

    for (const parent of rules.filter((existing) => inside(existing, rule))) {
      let step = parent
      while (step !== rule) {
        const children = TransferInclude.childrenOf(step, tree)
        const onPath = children.find((child) => child === rule || inside(child, rule))
        for (const child of children) {
          if (child !== onPath) kept.add(child)
        }
        if (!onPath) break
        step = onPath
      }
    }
    return [...kept].sort()
  }

  /**
   * Rolls a complete set of children up into the parent that stands for them.
   *
   * Without it, checking every collection in a scope one by one leaves the
   * scope above drawn as partial, and the column's own select-all box could
   * never settle on checked. Stops below the instance: there is no rule string
   * for "everything", and the empty list now means the opposite of it.
   */
  static collapse(rules: readonly string[], tree: TransferTree): string[] {
    let next = [...rules]
    for (const project of tree.projects) {
      for (const env of project.envs) {
        const scope = `${project.name}/${env.name}`
        const collections = env.collections.map((each) => `${scope}/${each.name}`)
        if (collections.length > 0 && collections.every((each) => TransferInclude.covered(next, each))) {
          next = TransferInclude.add(next, scope)
        }
      }
      const scopes = project.envs.map((env) => `${project.name}/${env.name}`)
      if (scopes.length > 0 && scopes.every((each) => TransferInclude.covered(next, each))) {
        next = TransferInclude.add(next, project.name)
      }
    }
    return next.sort()
  }

  /** Whether a rule is chosen outright or sits inside a broader chosen one. */
  static covered(rules: readonly string[], rule: string): boolean {
    return rules.some((existing) => existing === rule || rule.startsWith(`${existing}/`))
  }

  /** Whether some but not all of a rule's children are chosen. */
  static partial(rules: readonly string[], rule: string): boolean {
    if (TransferInclude.covered(rules, rule)) return false
    return rules.some((existing) => existing.startsWith(`${rule}/`))
  }

  /** Whether the selection already reaches every project the tree holds. */
  static everything(rules: readonly string[], tree: TransferTree): boolean {
    return tree.projects.every((project) => TransferInclude.covered(rules, project.name))
  }

  /** Every rule the tree offers at one level, for a column's select-all box. */
  static allProjects(tree: TransferTree): string[] {
    return tree.projects.map((project) => project.name).sort()
  }

  /**
   * The selection as the route wants it: the whole instance is the empty list,
   * never a list naming every project (§7.6).
   */
  static wire(rules: readonly string[], tree: TransferTree): string[] {
    return TransferInclude.everything(rules, tree) ? [] : [...rules]
  }

  /** One level down from a rule, as the tree has it. */
  private static childrenOf(rule: string, tree: TransferTree): string[] {
    const parts = rule.split('/')
    const project = tree.projects.find((each) => each.name === parts[0])
    if (!project) return []
    if (parts.length === 1) return project.envs.map((env) => `${project.name}/${env.name}`)
    const env = project.envs.find((each) => each.name === parts[1])
    if (!env || parts.length !== 2) return []
    return env.collections.map((collection) => `${rule}/${collection.name}`)
  }

  /** A one-line summary for a panel that has no room for the list. */
  static describe(rules: readonly string[]): string {
    if (rules.length === 0) return 'Nothing selected'
    if (rules.length === 1) return rules[0]!
    return `${rules.length} selections`
  }
}
