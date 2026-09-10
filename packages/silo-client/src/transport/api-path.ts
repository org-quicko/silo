/**
 * Every path in the client, built in one place. Every dynamic segment goes
 * through `encodeURIComponent`, so a name containing a slash or a space
 * addresses one resource rather than being split across the path.
 *
 * Uses `/envs/`, not `/environments/` — the guide says both are accepted
 *, and one spelling is enough to build with.
 */
export class ApiPath {
  static health(): string {
    return "/api/health";
  }

  static projects(): string {
    return "/api/projects";
  }

  static project(project: string): string {
    return `/api/projects/${encodeURIComponent(project)}`;
  }

  static environments(project: string): string {
    return `${ApiPath.project(project)}/envs`;
  }

  static environment(project: string, env: string): string {
    return `${ApiPath.environments(project)}/${encodeURIComponent(env)}`;
  }

  static projectVariables(project: string): string {
    return `${ApiPath.project(project)}/variables`;
  }

  static projectVariable(project: string, name: string): string {
    return `${ApiPath.projectVariables(project)}/${encodeURIComponent(name)}`;
  }

  static environmentVariables(project: string, env: string): string {
    return `${ApiPath.environment(project, env)}/variables`;
  }

  static environmentVariable(project: string, env: string, name: string): string {
    return `${ApiPath.environmentVariables(project, env)}/${encodeURIComponent(name)}`;
  }

  static collections(project: string, env: string): string {
    return `${ApiPath.environment(project, env)}/collections`;
  }

  static collection(project: string, env: string, name: string): string {
    return `${ApiPath.collections(project, env)}/${encodeURIComponent(name)}`;
  }

  static schemas(project: string, env: string): string {
    return `${ApiPath.environment(project, env)}/schemas`;
  }

  static collectionSchema(project: string, env: string, name: string): string {
    return `${ApiPath.collection(project, env, name)}/schema`;
  }

  /** List/create entries: the same address as `collection`, one level down
   * in what it means — the collection's own record versus its rows. */
  static entries(project: string, env: string, name: string): string {
    return ApiPath.collection(project, env, name);
  }

  static entry(project: string, env: string, name: string, id: string): string {
    return `${ApiPath.collection(project, env, name)}/${encodeURIComponent(id)}`;
  }

  static collectionSearch(project: string, env: string, name: string): string {
    return `${ApiPath.collection(project, env, name)}/search`;
  }

  static environmentSearch(project: string, env: string): string {
    return `${ApiPath.environment(project, env)}/search`;
  }

  static instanceSearch(): string {
    return "/api/search";
  }

  static media(): string {
    return "/api/media";
  }

  static mediaExtensions(): string {
    return "/api/media/extensions";
  }

  static mediaAsset(id: string): string {
    return `/api/media/${encodeURIComponent(id)}`;
  }

  static mediaAssetUsages(id: string): string {
    return `${ApiPath.mediaAsset(id)}/usages`;
  }

  static mediaBulkDelete(): string {
    return "/api/media/delete";
  }

  static mediaFolders(): string {
    return "/api/media/folders";
  }
}
