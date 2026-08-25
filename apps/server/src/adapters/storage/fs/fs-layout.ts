import path from "path";
import type { Scope } from "../../../core/domain/scope";

/**
 * The on-disk path grammar of an fs-backed data directory — the layout that
 * *is* the export format (D5), so a running instance is a live export and `cp`
 * or `rsync` is backup and replication.
 *
 * ```
 * <dir>/manifest.json
 * <dir>/projects/<project>/.silo-project
 * <dir>/projects/<project>/<env>/.silo-env
 * <dir>/projects/<project>/<env>/schemas/<collection>.schema.json
 * <dir>/projects/<project>/<env>/content/<collection>/<id>.json
 * ```
 *
 * Every path in this adapter is built here, so the layout is stated once.
 */
export class FsLayout {
  static readonly SchemaSuffix = ".schema.json";
  static readonly EntrySuffix = ".json";

  /** Markers are dotfiles at the root of their own directory, so every listing
   *  that skips dotfiles ignores them without knowing they exist. */
  static readonly ProjectMarker = ".silo-project";
  static readonly EnvMarker = ".silo-env";

  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get manifestFile(): string {
    return path.join(this.root, "manifest.json");
  }

  get projectsDir(): string {
    return path.join(this.root, "projects");
  }

  projectDir(project: string): string {
    return path.join(this.projectsDir, project);
  }

  envDir(project: string, env: string): string {
    return path.join(this.projectsDir, project, env);
  }

  scopeDir(scope: Scope): string {
    return this.envDir(scope.project, scope.env);
  }

  schemasDir(scope: Scope): string {
    return path.join(this.scopeDir(scope), "schemas");
  }

  schemaFile(scope: Scope, collection: string): string {
    return path.join(this.schemasDir(scope), `${collection}${FsLayout.SchemaSuffix}`);
  }

  contentDir(scope: Scope): string {
    return path.join(this.scopeDir(scope), "content");
  }

  collectionDir(scope: Scope, collection: string): string {
    return path.join(this.contentDir(scope), collection);
  }

  entryFile(scope: Scope, collection: string, id: string): string {
    return path.join(this.collectionDir(scope, collection), `${id}${FsLayout.EntrySuffix}`);
  }

  /** The collection name a schema filename encodes, or null. */
  static collectionOfSchemaFile(filename: string): string | null {
    if (!filename.endsWith(FsLayout.SchemaSuffix)) return null;
    return filename.slice(0, -FsLayout.SchemaSuffix.length);
  }

  /** The entry id a content filename encodes, or null. */
  static idOfEntryFile(filename: string): string | null {
    if (filename.startsWith(".") || !filename.endsWith(FsLayout.EntrySuffix)) return null;
    return filename.slice(0, -FsLayout.EntrySuffix.length);
  }
}
