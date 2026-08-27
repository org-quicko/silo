import fs from "fs/promises";
import path from "path";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";

/**
 * Projects and environments as directories plus marker files.
 *
 * A project or env can be created before it holds anything (D20), so "exists"
 * is not the same question as "has content". SQLite answers it with rows; this
 * adapter has only directories, and a directory alone is ambiguous — the tree
 * is left behind just the same when a scope's last schema and entry are
 * deleted, because nothing prunes it. A marker file written by the create call
 * separates the two, so both adapters agree: **a scope exists exactly when it
 * was created explicitly or still holds content.**
 */
export class FsScopeStore {
  private readonly layout: FsLayout;

  constructor(layout: FsLayout) {
    this.layout = layout;
  }

  async createProject(project: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    const projectDir = this.layout.projectDir(project);
    await fs.mkdir(projectDir, { recursive: true });
    await FsScopeStore.writeMarker(projectDir, FsLayout.ProjectMarker);
  }

  async listProjects(): Promise<string[]> {
    const names: string[] = [];
    for (const project of await FsFiles.readSubdirs(this.layout.projectsDir)) {
      if (await this.projectExists(project)) names.push(project);
    }
    return names;
  }

  async deleteProject(project: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    await fs.rm(this.layout.projectDir(project), { recursive: true, force: true });
  }

  async createEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    // The project row is implied by the environment row in SQLite, so mirror
    // that here: a project reached only through `createEnvironment` is listed
    // by both adapters.
    const projectDir = this.layout.projectDir(project);
    const envDir = this.layout.envDir(project, env);
    await fs.mkdir(envDir, { recursive: true });
    await FsScopeStore.writeMarker(projectDir, FsLayout.ProjectMarker);
    await FsScopeStore.writeMarker(envDir, FsLayout.EnvMarker);
  }

  async listEnvironments(project: string): Promise<string[]> {
    EntryUtils.assertSafeSegment(project, "project");
    const names: string[] = [];
    for (const env of await FsFiles.readSubdirs(this.layout.projectDir(project))) {
      if (await this.envExists(project, env)) names.push(env);
    }
    return names;
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    await fs.rm(this.layout.envDir(project, env), { recursive: true, force: true });
  }

  async listScopes(): Promise<Scope[]> {
    const scopes: Scope[] = [];

    for (const project of await FsFiles.readSubdirs(this.layout.projectsDir)) {
      for (const env of await FsFiles.readSubdirs(this.layout.projectDir(project))) {
        if (!(await this.envExists(project, env))) continue;

        // A directory pair that does not conform to the id grammar (a
        // hand-edited data dir, a bug elsewhere) is skipped rather than
        // allowed to crash every caller — export in particular.
        try {
          scopes.push(Scope.of(project, env));
        } catch {
          continue;
        }
      }
    }

    scopes.sort(
      (left, right) =>
        left.project.localeCompare(right.project) || left.env.localeCompare(right.env)
    );
    return scopes;
  }

  async envExists(project: string, env: string): Promise<boolean> {
    const envDir = this.layout.envDir(project, env);
    if (await FsFiles.exists(path.join(envDir, FsLayout.EnvMarker))) return true;
    return FsScopeStore.hasContent(envDir);
  }

  async projectExists(project: string): Promise<boolean> {
    const projectDir = this.layout.projectDir(project);
    if (await FsFiles.exists(path.join(projectDir, FsLayout.ProjectMarker))) return true;

    for (const env of await FsFiles.readSubdirs(projectDir)) {
      if (await this.envExists(project, env)) return true;
    }
    return false;
  }

  /** Written only when absent, mirroring SQLite's `INSERT OR IGNORE`: creating
   *  an existing project must not reset its recorded creation time. */
  private static async writeMarker(dir: string, name: string): Promise<void> {
    const marker = path.join(dir, name);
    if (await FsFiles.exists(marker)) return;
    await FsFiles.writeAtomic(
      marker,
      JSON.stringify({ created_at: EntryUtils.now().toISOString() })
    );
  }

  /** Whether a scope directory still holds a schema or an entry. */
  private static async hasContent(scopeDir: string): Promise<boolean> {
    const schemas = await FsFiles.readNames(path.join(scopeDir, "schemas"));
    if (schemas.some((name) => FsScopeStore.isLiveFile(name, FsLayout.SchemaSuffix))) {
      return true;
    }

    const contentDir = path.join(scopeDir, "content");
    for (const collection of await FsFiles.readNames(contentDir)) {
      const files = await FsFiles.readNames(path.join(contentDir, collection));
      if (files.some((name) => FsScopeStore.isLiveFile(name, FsLayout.EntrySuffix))) {
        return true;
      }
    }
    return false;
  }

  /** A dotfile is either a marker or an in-flight `.<name>-<rand>.tmp`, and
   *  neither is content. */
  private static isLiveFile(name: string, suffix: string): boolean {
    return !name.startsWith(".") && name.endsWith(suffix);
  }
}
