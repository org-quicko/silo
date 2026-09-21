import type { TransferTree } from './transfer-tree'

/**
 * The `project[/env[/collection]]` rules a transfer carries, and the tri-state
 * a tree of checkboxes needs to draw them.
 *
 * Immutable, like `ScopeCopySelection`: every method answers a new list. An
 * empty list is the whole instance, which is the same thing the server means by
 * an absent `include` (§7.6).
 */
export class TransferInclude {
  /**
   * Checks or unchecks one box.
   *
   * The one entry point the picker uses, because "everything" has two
   * spellings and only one of them is legal on the wire: a list naming every
   * project means the same thing as an empty list, and the empty list is what
   * the server reads as the whole instance. Collapsing here keeps the two from
   * drifting apart on screen.
   */
  static toggle(
    rules: readonly string[],
    rule: string,
    checked: boolean,
    tree: TransferTree,
  ): string[] {
    // "Everything" is the empty list, which has nothing to subtract from — so
    // the first uncheck has to write out what was implied before it can take
    // anything away from it.
    const current = rules.length === 0 ? tree.projects.map((project) => project.name) : rules
    const next = checked
      ? TransferInclude.add(current, rule)
      : TransferInclude.remove(current, rule, tree)
    const everything = tree.projects.every((project) => next.includes(project.name))
    return everything ? [] : next
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

  /** Whether a rule is chosen outright or sits inside a broader chosen one. */
  static covered(rules: readonly string[], rule: string): boolean {
    if (rules.length === 0) return true
    return rules.some((existing) => existing === rule || rule.startsWith(`${existing}/`))
  }

  /** Whether some but not all of a rule's children are chosen. */
  static partial(rules: readonly string[], rule: string): boolean {
    if (TransferInclude.covered(rules, rule)) return false
    return rules.some((existing) => existing.startsWith(`${rule}/`))
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
    if (rules.length === 0) return 'The whole instance'
    if (rules.length === 1) return rules[0]!
    return `${rules.length} selections`
  }
}
