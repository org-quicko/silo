import { CollectionName } from '@silo/shared/collection-name'

/** The shared collection-name rule (D104) as a sentence for the form, so the
 *  editor learns what is wrong before anything is sent. */
export class CollectionNameMessage {
  /** Null while `name` is usable, and for an empty field, which the save step reports on its own. */
  static of(name: string): string | null {
    if (name.length === 0) return null
    const problem = CollectionName.problem(name)
    return problem ? `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.` : null
  }
}
