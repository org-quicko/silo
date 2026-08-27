import { SchemaAccess } from "@silo/shared/schema-access";
import { ValidationError } from "@silo/shared/validation-error";
import type { ScopeCollection } from "../domain/scope-collection";
import { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import type { WriteContext } from "../hooks/write-context";
import { WriteContexts } from "../hooks/write-contexts";
import type { CollectionService } from "./collection-service";
import { CollectionEvents } from "./support/collection-events";
import { CollectionEraser } from "./support/collection-eraser";
import type { ServiceContext } from "./support/service-context";

/** One collection a scope delete erased, carried out of the write lock so the
 *  hook can be dispatched after it is released. */
interface Erased {
  scope: Scope;
  collection: string;
  erased: number;
}

/**
 * Projects and environments — the two plain string containers a collection is
 * addressed by (D18/D19/D20). Neither carries metadata beyond its id; both are
 * recorded explicitly so an empty one can exist.
 */
export class ScopeService {
  private readonly context: ServiceContext;
  private readonly collections: CollectionService;

  /** Derived from schema content, so it is dropped whenever schemas change. */
  private publicScopeCache: ReadonlyMap<string, ReadonlySet<string>> | null = null;

  constructor(context: ServiceContext, collections: CollectionService) {
    this.context = context;
    this.collections = collections;
    context.schemaRegistry.onInvalidate(() => {
      this.publicScopeCache = null;
    });
  }

  /**
   * Creates the configured default project and environment if they are missing.
   *
   * The ids come from configuration (`--project`/`--env`, the TOML file, or
   * `SILO_DEFAULT_*`), so they get the same validation every other id gets.
   * Skipping it created a scope no route could address and `deleteProject`
   * then refused to delete — an unreachable, unremovable project produced by a
   * typo in an env var. Failing at startup makes the typo obvious.
   */
  async initDefaults(defaultProject = "default", defaultEnv = "prod"): Promise<void> {
    let scope: Scope;
    try {
      scope = Scope.of(defaultProject, defaultEnv);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ValidationError(
        `invalid default scope in configuration (--project/--env, default_project/default_env, or SILO_DEFAULT_PROJECT/SILO_DEFAULT_ENV): ${reason}`
      );
    }

    await this.context.withWriteLock(async () => {
      await this.context.store.createProject(scope.project);
      await this.context.store.createEnvironment(scope.project, scope.env);
    });
  }

  async listProjects(): Promise<string[]> {
    return this.context.store.listProjects();
  }

  async createProject(project: string): Promise<void> {
    Scope.validateProject(project);
    await this.context.withWriteLock(() => this.context.store.createProject(project));
  }

  async deleteProject(
    project: string,
    force: boolean,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<void> {
    Scope.validateProject(project);

    const erased = await this.context.withWriteLock(async () => {
      // Every environment is inspected before any of them is touched: checking
      // and erasing env by env would empty the first environments before
      // discovering that a later one still holds content, leaving the project
      // half-deleted and the request reporting failure.
      const plans: Array<{ scope: Scope; collections: ScopeCollection[] }> = [];
      for (const env of await this.context.store.listEnvironments(project)) {
        const scope = Scope.of(project, env);
        plans.push({ scope, collections: await this.collectionsIn(scope) });
      }

      if (!force) {
        for (const plan of plans) {
          ScopeService.refuseNonEmpty(
            `project "${project}" environment "${plan.scope.env}"`,
            plan.collections
          );
        }
      }

      const counts: Erased[] = [];
      for (const plan of plans) {
        for (const collection of plan.collections) {
          counts.push({
            scope: plan.scope,
            collection: collection.name,
            erased: await CollectionEraser.erase(this.context.store, plan.scope, collection.name),
          });
        }
      }
      this.context.schemaRegistry.invalidate();
      await this.context.store.deleteProject(project);
      return counts;
    });

    await this.dispatchErased(erased, "project", writeContext);
  }

  async listEnvironments(project: string): Promise<string[]> {
    Scope.validateProject(project);
    return this.context.store.listEnvironments(project);
  }

  async createEnvironment(project: string, env: string): Promise<Scope> {
    const scope = Scope.of(project, env);
    await this.context.withWriteLock(() =>
      this.context.store.createEnvironment(project, env)
    );
    return scope;
  }

  async deleteEnvironment(
    project: string,
    env: string,
    force: boolean,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<void> {
    const scope = Scope.of(project, env);

    const erased = await this.context.withWriteLock(async () => {
      const collections = await this.collectionsIn(scope);
      if (!force) {
        ScopeService.refuseNonEmpty(`environment "${scope.key()}"`, collections);
      }
      const counts: Erased[] = [];
      for (const collection of collections) {
        counts.push({
          scope,
          collection: collection.name,
          erased: await CollectionEraser.erase(this.context.store, scope, collection.name),
        });
      }
      this.context.schemaRegistry.invalidate();
      await this.context.store.deleteEnvironment(project, env);
      return counts;
    });

    await this.dispatchErased(erased, "environment", writeContext);
  }

  /**
   * One `collection.afterDelete` per collection the scope delete erased,
   * dispatched after the lock (D36, closing D37's F6).
   *
   * In order and one at a time, matching how `HookBus` already delivers: a
   * plugin mirroring a scope wants to see it emptied in the order it was
   * emptied, and a fan-out here would let a slow plugin overlap itself.
   */
  private async dispatchErased(
    erased: readonly Erased[],
    cause: "environment" | "project",
    writeContext: WriteContext
  ): Promise<void> {
    for (const each of erased) {
      await this.context.hooks.afterCollectionDelete(
        CollectionEvents.deleted(writeContext, each.scope, each.collection, each.erased, cause)
      );
    }
  }

  async list(): Promise<Scope[]> {
    return this.context.store.listScopes();
  }

  /**
   * Which scopes expose at least one collection readable without a key, as
   * `project -> envs`.
   *
   * Anonymous project and env discovery needs this, and computing it reads
   * every schema in the instance — so it is derived once and held until the
   * next schema write.
   */
  async publicScopes(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    if (this.publicScopeCache) return this.publicScopeCache;

    const found = new Map<string, Set<string>>();
    for (const scope of await this.context.store.listScopes()) {
      const collections = await this.collections.list(scope);
      const anyPublic = collections.some(
        (collection) => !SchemaAccess.requiresAuth(collection.schema)
      );
      if (!anyPublic) continue;

      const environments = found.get(scope.project);
      if (environments) environments.add(scope.env);
      else found.set(scope.project, new Set([scope.env]));
    }

    this.publicScopeCache = found;
    return found;
  }

  /** Every collection in `scope`, from both sides of the schema/entry split,
   *  with each one's entry count. */
  private async collectionsIn(scope: Scope): Promise<ScopeCollection[]> {
    const names = [
      ...new Set([
        ...(await this.context.store.listSchemas(scope)).keys(),
        ...(await this.context.store.listEntryCollections(scope)),
      ]),
    ].sort();

    const collections: ScopeCollection[] = [];
    for (const name of names) {
      const { total } = await this.context.store.list(scope, name, { limit: 1, offset: 0 });
      collections.push({ name, total });
    }
    return collections;
  }

  /**
   * `force` guards the collections themselves, not just their rows. Gating on
   * entry counts alone let an un-forced delete destroy every schema in a
   * scope — a project holding twenty collection definitions and no content yet
   * is exactly the state a project is in right after it is set up.
   */
  private static refuseNonEmpty(subject: string, collections: ScopeCollection[]): void {
    if (collections.length === 0) return;

    const listed = collections
      .map((collection) => `"${collection.name}" (${collection.total})`)
      .join(", ");
    throw new ConflictError(
      `${subject} still has collections (name and entry count): ${listed}; delete them or pass force`
    );
  }
}
