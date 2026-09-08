import { SiloNames } from '../silo/silo-names'
import type { StrapiInventory } from '../strapi/strapi-inventory'
import type { ImportMode, ImportStep } from './import-plan'

/**
 * Reading one step of a plan, validated against the source it names.
 *
 * Its own file because `ImportPlans` already carries the plan-wide checks —
 * the scope, the media folder and layout — and a step's own checks are a
 * second, unrelated set: which list, which mode, whether it may be flattened.
 * Kept apart so neither file grows past the point one screen can hold it.
 */
export class ImportSteps {
  static readonly Modes: readonly ImportMode[] = ['append', 'replace', 'skip']

  /** One step from the panel, or a refusal naming the step. */
  static read(raw: unknown, inventory: StrapiInventory): ImportStep {
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
    if (!(ImportSteps.Modes as readonly unknown[]).includes(mode)) {
      throw new Error(`step "${list.id}" has "mode": ${JSON.stringify(entry.mode)}`)
    }

    const flatten = entry.flatten === undefined ? false : entry.flatten
    if (typeof flatten !== 'boolean') {
      throw new Error(`step "${list.id}" has "flatten": ${JSON.stringify(entry.flatten)}`)
    }
    if (flatten && !list.flatten) {
      throw new Error(
        `step "${list.id}" cannot be flattened: only a single type whose one field is a ` +
          `repeatable component can be imported one entry per item`,
      )
    }

    return {
      list: list.id,
      collection: SiloNames.check(entry.collection, `step "${list.id}" collection`),
      mode: mode as ImportMode,
      include: entry.include !== false,
      flatten,
    }
  }
}
