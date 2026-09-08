import type { StrapiDatabase } from './strapi-database'
import type { StrapiList } from './strapi-inventory'
import { StrapiRows } from './strapi-rows'
import type { StrapiVersion } from './strapi-versions'

/**
 * Which collections of a run reference each upload, by filename.
 *
 * **From the rows the run will write, not from a component uid.** One
 * component can be nested under two content types, and asking "which content
 * types name this uid" would answer both even when only one of them actually
 * attaches the file. Reading the rows themselves — after flattening, which
 * changes nothing about which files a row holds — is what makes `by-collection`
 * exact rather than a guess.
 *
 * Re-reads every included list once before the run, deliberately: a staged
 * SQLite file is cheap to read twice, and holding every list's rows in memory
 * at once for the run that follows is not. Only worth calling under
 * `by-collection`.
 */
export class StrapiMediaOwners {
  static read(
    source: StrapiDatabase,
    steps: readonly { list: StrapiList; collection: string; flatten: boolean }[],
    version: StrapiVersion,
  ): Map<string, Set<string>> {
    const owners = new Map<string, Set<string>>()

    for (const step of steps) {
      const rows = StrapiRows.read(source, step.list, version, step.flatten)
      for (const row of rows) {
        for (const slot of row.media) {
          for (const file of slot.files) {
            const set = owners.get(file.name) ?? new Set<string>()
            set.add(step.collection)
            owners.set(file.name, set)
          }
        }
      }
    }
    return owners
  }
}
