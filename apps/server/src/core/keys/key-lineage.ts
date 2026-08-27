import type { KeyInfo } from "./key-info";

/** One `_keys` record paired with its id, which the record does not carry. */
export interface IdentifiedKey {
  id: string;
  info: KeyInfo;
}

/**
 * Who minted whom (D38), and the walk that revocation follows.
 *
 * Kept out of `KeyService` because it is pure set arithmetic over records the
 * service already read: a walk that needs no storage is easier to trust, and
 * easier to test against a hand-built tree than against a database.
 */
export class KeyLineage {
  /**
   * Every key descended from `rootId`, nearest first, excluding `rootId`.
   *
   * Breadth-first with a visited set. A parent must exist before its child, so a
   * cycle cannot arise from ordinary use — but `_keys` is an ordinary collection
   * that an import or a hand edit can write, and a walk that loops forever on a
   * malformed record would turn a bad row into a hung revocation. The visited
   * set costs nothing and removes the question.
   */
  static descendantsOf(keys: readonly IdentifiedKey[], rootId: string): IdentifiedKey[] {
    const children = new Map<string, IdentifiedKey[]>();
    for (const key of keys) {
      const parent = key.info.parent_id;
      if (!parent) continue;
      const bucket = children.get(parent);
      if (bucket) bucket.push(key);
      else children.set(parent, [key]);
    }

    const found: IdentifiedKey[] = [];
    const visited = new Set<string>([rootId]);
    let frontier = children.get(rootId) ?? [];

    while (frontier.length > 0) {
      const next: IdentifiedKey[] = [];
      for (const key of frontier) {
        if (visited.has(key.id)) continue;
        visited.add(key.id);
        found.push(key);
        next.push(...(children.get(key.id) ?? []));
      }
      frontier = next;
    }
    return found;
  }
}
