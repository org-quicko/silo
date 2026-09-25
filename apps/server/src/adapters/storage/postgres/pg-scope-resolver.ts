import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";
import type { PgCollectionAddress } from "./pg-collection-address";
import type { PgQueryable } from "./pg-queryable";
import type { PgTables } from "./pg-tables";

/**
 * Names in, ids out (D51), with the flat cache `SqliteScopeResolver` explains.
 *
 * One difference, because a lookup here awaits: a record write can commit
 * while a lookup is in flight, and the lookup would then cache the name's old
 * answer after the write had cleared it. So `clear` also advances a
 * generation, and a lookup caches its answer only if no clear happened while
 * it ran. Stores clear before a record write as well as after it, which closes
 * the gap between the commit and the second clear.
 */
export class PgScopeResolver {
  private readonly database: PgQueryable;
  private readonly tables: PgTables;
  private readonly cache = new Map<string, string | null>();
  private generation = 0;

  constructor(database: PgQueryable, tables: PgTables) {
    this.database = database;
    this.tables = tables;
  }

  clear(): void {
    this.cache.clear();
    this.generation += 1;
  }

  /** Runs a record write with the cache cleared on both sides of it. */
  async invalidating<T>(write: () => Promise<T>): Promise<T> {
    this.clear();
    try {
      return await write();
    } finally {
      this.clear();
    }
  }

  async projectId(name: string): Promise<string | null> {
    return this.lookup(`project:${name}`, `SELECT id FROM ${this.tables.projects} WHERE name = $1`, [
      name,
    ]);
  }

  async environmentId(project: string, env: string): Promise<string | null> {
    const projectId = await this.projectId(project);
    if (projectId === null) return null;
    return this.lookup(
      `env:${projectId}/${env}`,
      `SELECT id FROM ${this.tables.environments} WHERE project_id = $1 AND name = $2`,
      [projectId, env]
    );
  }

  async collectionId(scope: Scope, collection: string): Promise<string | null> {
    return this.collectionIdIn(scope.project, scope.env, collection);
  }

  /** By names rather than a `Scope`, for the reason `SqliteScopeResolver` gives. */
  async collectionIdIn(project: string, env: string, collection: string): Promise<string | null> {
    const envId = await this.environmentId(project, env);
    if (envId === null) return null;
    return this.lookup(
      `collection:${envId}/${collection}`,
      `SELECT id FROM ${this.tables.collections} WHERE env_id = $1 AND name = $2`,
      [envId, collection]
    );
  }

  /** The full address of one collection, or a `NotFoundError` naming it. */
  async requireCollectionIn(
    project: string,
    env: string,
    collection: string
  ): Promise<PgCollectionAddress> {
    const projectId = await this.projectId(project);
    const envId = projectId === null ? null : await this.environmentId(project, env);
    const collectionId =
      envId === null ? null : await this.collectionIdIn(project, env, collection);
    if (projectId === null || envId === null || collectionId === null) {
      throw new NotFoundError(`collection "${project}/${env}/${collection}" not found`);
    }
    return { projectId, envId, collectionId, project, env, collection };
  }

  private async lookup(key: string, sql: string, params: string[]): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const generation = this.generation;
    const rows = await this.database.query<{ id: string }>(sql, params);
    const found = rows.length > 0 ? rows[0].id : null;
    if (generation === this.generation) this.cache.set(key, found);
    return found;
  }
}
