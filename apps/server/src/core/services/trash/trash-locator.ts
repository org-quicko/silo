import { Scope } from "../../domain/scope";
import type { Storage } from "../../ports/storage";

/**
 * Turns the record ids a receipt holds back into the names the `Storage` port
 * addresses by (D91).
 *
 * This indirection is the whole reason a receipt stores ids: names are mutable
 * (D51), so a project renamed between delete and restore would otherwise send
 * the content nowhere or somewhere wrong. Cached per restore, and `remember`
 * lets a replay resolve a container it has only just recreated.
 */
export class TrashLocator {
  private readonly store: Storage;
  private readonly projects = new Map<string, string>();
  private readonly environments = new Map<string, string>();
  private readonly collections = new Map<string, string>();

  constructor(store: Storage) {
    this.store = store;
  }

  /** Records a name for an id the live tables do not hold yet. */
  remember(kind: "project" | "environment" | "collection", id: string, name: string): void {
    if (kind === "project") this.projects.set(id, name);
    else if (kind === "environment") this.environments.set(id, name);
    else this.collections.set(id, name);
  }

  async projectName(id: string): Promise<string | null> {
    const cached = this.projects.get(id);
    if (cached !== undefined) return cached;
    for (const record of await this.store.listProjects()) {
      this.projects.set(record.id, record.name);
    }
    return this.projects.get(id) ?? null;
  }

  async environmentName(projectId: string, id: string): Promise<string | null> {
    const cached = this.environments.get(id);
    if (cached !== undefined) return cached;
    const project = await this.projectName(projectId);
    if (!project) return null;
    for (const record of await this.store.listEnvironments(project)) {
      this.environments.set(record.id, record.name);
    }
    return this.environments.get(id) ?? null;
  }

  async collectionName(projectId: string, envId: string, id: string): Promise<string | null> {
    const cached = this.collections.get(id);
    if (cached !== undefined) return cached;
    const scope = await this.scopeOf(projectId, envId);
    if (!scope) return null;
    for (const record of await this.store.listCollections(scope)) {
      this.collections.set(record.id, record.name);
    }
    return this.collections.get(id) ?? null;
  }

  /** The live scope a (project id, env id) pair names, or null if either is
   *  gone. */
  async scopeOf(projectId: string, envId: string): Promise<Scope | null> {
    const project = await this.projectName(projectId);
    if (!project) return null;
    const env = await this.environmentName(projectId, envId);
    if (!env) return null;
    return Scope.of(project, env);
  }
}
