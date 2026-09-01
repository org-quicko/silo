import type { Database } from "bun:sqlite";
import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";

/**
 * Where one collection's rows live, both ways round.
 *
 * The ids are what a write stores; the names are what the entry envelope
 * carries and what the index's system-data guard has to read, and the resolver
 * knew both to get here — so carrying them costs nothing and saves every
 * consumer a lookup back.
 */
export interface CollectionAddress {
  projectId: string;
  envId: string;
  collectionId: string;
  project: string;
  env: string;
  collection: string;
}

/**
 * Names in, ids out (D51).
 *
 * Every port method addresses by name and every table stores ids, so this is
 * the one place the two meet. It resolves **forwards only**: the reverse
 * direction is needed by just the few queries that span scopes — media usages,
 * search hits, `listEntryCollections` — and those join to the record tables in
 * SQL, which keeps the page boundary and the ordering on the names rather than
 * on the ids underneath them. Single-scope reads never need it at all, since
 * the caller passed the names in.
 *
 * The cache is flat and cleared whole on any write. Creates, renames and
 * deletes are rare next to reads, so a precise invalidation would be more code
 * for a saving nothing measures. `null` is cached too — a miss is an answer,
 * and the alternative is re-querying for every write to a scope that does not
 * exist.
 */
export class SqliteScopeResolver {
  private readonly database: Database;
  private readonly cache = new Map<string, string | null>();

  constructor(database: Database) {
    this.database = database;
  }

  /** Called by every store after any record write. */
  clear(): void {
    this.cache.clear();
  }

  projectId(name: string): string | null {
    return this.lookup(`project:${name}`, () => {
      const row = this.database
        .prepare(`SELECT id FROM projects WHERE name = ?`)
        .get(name) as { id: string } | undefined;
      return row ? row.id : null;
    });
  }

  environmentId(project: string, env: string): string | null {
    const projectId = this.projectId(project);
    if (projectId === null) return null;

    return this.lookup(`env:${projectId}/${env}`, () => {
      const row = this.database
        .prepare(`SELECT id FROM environments WHERE project_id = ? AND name = ?`)
        .get(projectId, env) as { id: string } | undefined;
      return row ? row.id : null;
    });
  }

  collectionId(scope: Scope, collection: string): string | null {
    return this.collectionIdIn(scope.project, scope.env, collection);
  }

  /**
   * By names rather than by a `Scope`, because the reserved `_system` pair
   * cannot be rebuilt through `Scope.of` — its own grammar refuses a leading
   * underscore, and the singleton bypasses the factory. An entry's envelope
   * arrives here as two strings, and `_keys` writes are entries like any other.
   */
  collectionIdIn(project: string, env: string, collection: string): string | null {
    const envId = this.environmentId(project, env);
    if (envId === null) return null;

    return this.lookup(`collection:${envId}/${collection}`, () => {
      const row = this.database
        .prepare(`SELECT id FROM collections WHERE env_id = ? AND name = ?`)
        .get(envId, collection) as { id: string } | undefined;
      return row ? row.id : null;
    });
  }

  /** Both ids of a scope, or null when either half is missing. */
  scopeIds(scope: Scope): { projectId: string; envId: string } | null {
    return this.scopeIdsIn(scope.project, scope.env);
  }

  scopeIdsIn(project: string, env: string): { projectId: string; envId: string } | null {
    const projectId = this.projectId(project);
    if (projectId === null) return null;
    const envId = this.environmentId(project, env);
    if (envId === null) return null;
    return { projectId, envId };
  }

  /**
   * The full address of one collection.
   *
   * A missing collection is a `NotFoundError` naming the collection rather than
   * the scope, because that is the answer the caller is asking for even when
   * the scope is what is actually absent.
   */
  requireCollection(scope: Scope, collection: string): CollectionAddress {
    return this.requireCollectionIn(scope.project, scope.env, collection);
  }

  requireCollectionIn(project: string, env: string, collection: string): CollectionAddress {
    const ids = this.scopeIdsIn(project, env);
    const collectionId = ids === null ? null : this.collectionIdIn(project, env, collection);
    if (ids === null || collectionId === null) {
      throw new NotFoundError(`collection "${project}/${env}/${collection}" not found`);
    }
    return { ...ids, collectionId, project, env, collection };
  }

  private lookup(key: string, read: () => string | null): string | null {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const found = read();
    this.cache.set(key, found);
    return found;
  }
}
