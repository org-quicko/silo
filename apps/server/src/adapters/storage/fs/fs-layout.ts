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
 * <dir>/projects/<project>/<env>/schemas/.<collection>.silo-collection
 * <dir>/projects/<project>/<env>/content/<collection>/<id>.json
 * ```
 *
 * Every path in this adapter is built here, so the layout is stated once.
 *
 * The directory names are still the **names**, not the record ids (D51):
 * this layout is the export format and is meant to be read and diffed by a
 * human, so the ids live in the markers and a rename is a directory move.
 */
export class FsLayout {
  static readonly SchemaSuffix = ".schema.json";
  static readonly EntrySuffix = ".json";

  /** Markers are dotfiles at the root of their own directory, so every listing
   *  that skips dotfiles ignores them without knowing they exist. */
  static readonly ProjectMarker = ".silo-project";
  static readonly EnvMarker = ".silo-env";
  /** A collection's marker sits beside its schema rather than inside
   *  `content/<collection>/`, because a collection with no entries has no
   *  content directory while it always has a schema (D51). */
  static readonly CollectionMarkerSuffix = ".silo-collection";

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
    return this.schemasDirIn(scope.project, scope.env);
  }

  /** By names, for the one caller that has an entry envelope rather than a
   *  `Scope` — the reserved `_system` pair cannot be rebuilt through
   *  `Scope.of`. */
  schemasDirIn(project: string, env: string): string {
    return path.join(this.envDir(project, env), "schemas");
  }

  schemaFile(scope: Scope, collection: string): string {
    return path.join(this.schemasDir(scope), `${collection}${FsLayout.SchemaSuffix}`);
  }

  collectionMarkerFile(scope: Scope, collection: string): string {
    return this.collectionMarkerFileIn(scope.project, scope.env, collection);
  }

  collectionMarkerFileIn(project: string, env: string, collection: string): string {
    return path.join(
      this.schemasDirIn(project, env),
      `.${collection}${FsLayout.CollectionMarkerSuffix}`
    );
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

  /** The collection name a marker filename encodes, or null. */
  static collectionOfMarkerFile(filename: string): string | null {
    if (!filename.startsWith(".") || !filename.endsWith(FsLayout.CollectionMarkerSuffix)) {
      return null;
    }
    return filename.slice(1, -FsLayout.CollectionMarkerSuffix.length);
  }
}
