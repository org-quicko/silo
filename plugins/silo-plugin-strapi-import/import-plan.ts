import type { StrapiInventory, StrapiList } from './strapi-inventory'
import type { StrapiVersion } from './strapi-versions'
import { StrapiVersions } from './strapi-versions'

/** What to do about a target collection that already has entries. */
export type ImportMode = 'append' | 'replace' | 'skip'

/** One list, and where it is going. */
export interface ImportStep {
  /** `StrapiList.id`. */
  list: string
  /** The silo collection to write into. */
  collection: string
  mode: ImportMode
  /** Unticked steps stay on the plan and are not run — an operator narrowing an
   *  import should be able to see what they left out. */
  include: boolean
}

export interface ImportPlan {
  project: string
  env: string
  version: StrapiVersion
  mediaBaseUrl: string
  steps: ImportStep[]
}

/**
 * The proposal an operator edits, and the validation of what comes back.
 *
 * A plan is a separate artifact from the import that runs it because the two
 * answer to different people: this is what silo *suggests*, and the panel is
 * where a human disagrees. Nothing is written until a plan comes back through
 * `ImportPlans.read`, so "what will happen" is always a document somebody could
 * have read.
 *
 * The default mapping is **one collection per list, one entry per row**, and that
 * is a real modelling decision rather than a mechanical translation. A Strapi
 * single type holding a repeatable component is a table wearing a single type as
 * a hat: the alternative — one entry holding a 251-element array — is faithful to
 * the source and wrong for the destination, because it is one `rev` for the whole
 * table, unsearchable per row, and not how anybody would model it if they were
 * starting here.
 */
export class ImportPlans {
  static readonly Modes: readonly ImportMode[] = ['append', 'replace', 'skip']

  /** silo collection names: lowercase, digits, `_`. Applied here so a proposed
   *  name is one silo will accept rather than one the first write rejects. */
  private static readonly Allowed = /[^a-z0-9_]+/g

  /** What silo would do with this export if nobody edited anything. */
  static propose(
    inventory: StrapiInventory,
    defaults: { project: string; env: string; prefix: string; mediaBaseUrl: string },
  ): ImportPlan {
    const taken = new Set<string>()
    const steps = inventory.lists.map((list) => ({
      list: list.id,
      collection: ImportPlans.unique(
        defaults.prefix + ImportPlans.nameFor(list),
        taken,
      ),
      // `append` and not `replace`, because a plan that defaults to deleting is a
      // plan somebody runs once without reading. Emptying a collection is
      // available, and it is a thing an operator has to choose.
      mode: 'append' as ImportMode,
      include: list.count > 0,
    }))

    return {
      project: defaults.project,
      env: defaults.env,
      version: inventory.version,
      mediaBaseUrl: defaults.mediaBaseUrl,
      steps,
    }
  }

  /**
   * A plan from the panel, validated, or a refusal naming the field.
   *
   * Every value is re-checked even though the panel produced it from a proposal:
   * the panel is a plugin's own HTML in somebody's browser, and it reaches this
   * route through a relay that authenticates the operator without vouching for
   * the body.
   */
  static read(raw: unknown, inventory: StrapiInventory): ImportPlan {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('want a plan object — { project, env, steps: [...] }')
    }
    const body = raw as Record<string, unknown>

    const version = body.version === undefined ? inventory.version : body.version
    if (!StrapiVersions.isVersion(version)) {
      throw new Error(`"version" must be one of ${StrapiVersions.All.join(', ')}`)
    }
    if (version !== inventory.version) {
      throw new Error(
        `this plan is for the ${version} version and the source was read as ` +
          `${inventory.version}. Re-read the source before importing, so the counts on the ` +
          `plan are the counts that will be written.`,
      )
    }

    const steps: ImportStep[] = []
    const seen = new Set<string>()
    for (const entry of ImportPlans.array(body.steps)) {
      const step = ImportPlans.step(entry, inventory)
      if (!step.include) continue
      if (seen.has(step.collection)) {
        throw new Error(
          `two steps both write into "${step.collection}". One collection per list, or the ` +
            `second import would silently interleave with the first.`,
        )
      }
      seen.add(step.collection)
      steps.push(step)
    }
    if (steps.length === 0) throw new Error('no steps are included, so there is nothing to import')

    return {
      project: ImportPlans.identifier(body.project, 'project'),
      env: ImportPlans.identifier(body.env, 'env'),
      version,
      mediaBaseUrl: typeof body.mediaBaseUrl === 'string' ? body.mediaBaseUrl : '',
      steps,
    }
  }

  /** The proposed collection name for one list. */
  static nameFor(list: StrapiList): string {
    // The component's own name, not the content type's: `org-quicko.bank` inside
    // `Org-quicko-bank` is the thing being imported, and the wrapper single type
    // is Strapi's way of holding a table rather than part of what it holds.
    const source = list.component ?? list.contentType.split('.').pop() ?? list.contentType
    const tail = source.split('.').pop() ?? source
    const name = tail.replace(/-/g, '_').toLowerCase().replace(ImportPlans.Allowed, '_')
    return name.replace(/^_+|_+$/g, '') || 'imported'
  }

  private static unique(name: string, taken: Set<string>): string {
    let candidate = name
    let suffix = 2
    while (taken.has(candidate)) candidate = `${name}_${suffix++}`
    taken.add(candidate)
    return candidate
  }

  private static step(raw: unknown, inventory: StrapiInventory): ImportStep {
    if (!raw || typeof raw !== 'object') throw new Error('every step must be an object')
    const entry = raw as Record<string, unknown>

    const list = inventory.lists.find((candidate) => candidate.id === String(entry.list))
    if (!list) {
      throw new Error(
        `step "${String(entry.list)}" names no list in this source. Re-read the source: a ` +
          `plan built against a different database cannot be applied to this one.`,
      )
    }

    const mode = entry.mode === undefined ? 'append' : entry.mode
    if (!(ImportPlans.Modes as readonly unknown[]).includes(mode)) {
      throw new Error(`step "${list.id}" has "mode": ${JSON.stringify(entry.mode)}`)
    }

    return {
      list: list.id,
      collection: ImportPlans.identifier(entry.collection, `step "${list.id}" collection`),
      mode: mode as ImportMode,
      include: entry.include !== false,
    }
  }

  private static array(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) throw new Error('"steps" must be an array')
    return raw
  }

  private static identifier(raw: unknown, what: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${what} must be a non-empty string`)
    }
    const value = raw.trim()
    if (ImportPlans.Allowed.test(value)) {
      // Reset, because a global regex used with `test` keeps `lastIndex`.
      ImportPlans.Allowed.lastIndex = 0
      throw new Error(
        `${what} "${value}" is not a usable name — lowercase letters, digits and underscores`,
      )
    }
    ImportPlans.Allowed.lastIndex = 0
    return value
  }
}
