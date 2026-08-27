import { SiloNames } from './silo-names'
import type { StrapiInventory } from './strapi-inventory'
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
  /** The Strapi instance still serving the uploads. Used for a file whose bytes
   *  were not supplied, which keeps its Strapi URL rather than importing. */
  mediaBaseUrl: string
  /** Where in silo's media library supplied uploads land. */
  mediaFolder: string
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

  /** What silo would do with this export if nobody edited anything. */
  static propose(
    inventory: StrapiInventory,
    defaults: {
      project: string
      env: string
      prefix: string
      mediaBaseUrl: string
      mediaFolder: string
    },
  ): ImportPlan {
    const taken = new Set<string>()
    const steps = inventory.lists.map((list) => ({
      list: list.id,
      collection: SiloNames.unique(defaults.prefix + SiloNames.forList(list), taken),
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
      mediaFolder: defaults.mediaFolder,
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
      project: SiloNames.check(body.project, 'project'),
      env: SiloNames.check(body.env, 'env'),
      version,
      mediaBaseUrl: typeof body.mediaBaseUrl === 'string' ? body.mediaBaseUrl : '',
      mediaFolder: ImportPlans.folder(body.mediaFolder),
      steps,
    }
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
      collection: SiloNames.check(entry.collection, `step "${list.id}" collection`),
      mode: mode as ImportMode,
      include: entry.include !== false,
    }
  }

  /**
   * A media folder silo will accept, normalised.
   *
   * Not run through `SiloNames`: a folder is a path, `/` is meaningful in it, and
   * silo normalises the leading and trailing slashes itself. The one thing refused
   * is `..`, because a folder is a place in the library and not a way out of it.
   */
  private static folder(raw: unknown): string {
    if (typeof raw !== 'string') return ''
    const value = raw.trim().replace(/^\/+|\/+$/g, '')
    if (value.length === 0) return ''
    if (value.split('/').includes('..')) {
      throw new Error(`"mediaFolder" may not contain ".." — it names a folder in silo's library`)
    }
    return value
  }

  private static array(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) throw new Error('"steps" must be an array')
    return raw
  }
}
