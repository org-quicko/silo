import fs from "fs/promises";
import path from "path";
import type { Entry } from "../domain/entry";
import { Scope } from "../domain/scope";

export interface ScopedImport {
  scope: Scope;
  schemas: Map<string, any>;
  entries: Map<string, Entry[]>;
}

/**
 * Directory-walking helpers for Importer.
 * Supports the scoped layout (format_version "2"):
 * projects/{project}/{env}/schemas/{col}.schema.json,
 * projects/{project}/{env}/content/{col}/{id}.json — the scope and
 * collection name come from the path directly, which is the addressing
 * authority (D18): entries' project/env fields are overwritten from the path
 * even if the file itself disagrees.
 */
export class ImportWalker {
  static async walkProjects(src: string): Promise<ScopedImport[]> {
    const projectsDir = path.join(src, "projects");
    const results: ScopedImport[] = [];

    for (const p of await ImportWalker.readdirSafe(projectsDir)) {
      if (p.startsWith(".")) continue;
      const projectPath = path.join(projectsDir, p);
      if (!(await ImportWalker.isDir(projectPath))) continue;

      for (const e of await ImportWalker.readdirSafe(projectPath)) {
        if (e.startsWith(".")) continue;
        const envPath = path.join(projectPath, e);
        if (!(await ImportWalker.isDir(envPath))) continue;

        const scope = p === Scope.System.project && e === Scope.System.env
          ? Scope.System
          : Scope.of(p, e);

        const schemas = new Map<string, any>();
        const entries = new Map<string, Entry[]>();
        await ImportWalker.walkSchemas(envPath, schemas);
        await ImportWalker.walkContent(envPath, scope, entries);
        results.push({ scope, schemas, entries });
      }
    }
    return results;
  }

  private static async walkSchemas(scopeDir: string, schemas: Map<string, any>): Promise<void> {
    const schemasDir = path.join(scopeDir, "schemas");
    for (const f of await ImportWalker.readdirSafe(schemasDir)) {
      if (f.startsWith(".") || !f.endsWith(".schema.json")) continue;
      const name = f.slice(0, -".schema.json".length);
      const data = await fs.readFile(path.join(schemasDir, f), "utf8");
      schemas.set(name, JSON.parse(data));
    }
  }

  private static async walkContent(
    scopeDir: string,
    scope: Scope,
    entries: Map<string, Entry[]>
  ): Promise<void> {
    const contentDir = path.join(scopeDir, "content");
    for (const d of await ImportWalker.readdirSafe(contentDir)) {
      if (d.startsWith(".")) continue;
      const colPath = path.join(contentDir, d);
      if (!(await ImportWalker.isDir(colPath))) continue;

      entries.set(d, await ImportWalker.readEntries(colPath, scope, d));
    }
  }

  private static async readEntries(colPath: string, scope: Scope, collection: string): Promise<Entry[]> {
    const files = await fs.readdir(colPath);
    const colEntries: Entry[] = [];
    for (const f of files) {
      if (f.startsWith(".") || !f.endsWith(".json")) continue;
      const data = await fs.readFile(path.join(colPath, f), "utf8");
      const parsed = JSON.parse(data);
      colEntries.push({
        id: parsed.id,
        project: scope.project,
        env: scope.env,
        collection: collection,
        rev: parsed.rev,
        seq: parsed.seq,
        created_at: new Date(parsed.created_at),
        updated_at: new Date(parsed.updated_at),
        data: parsed.data,
      });
    }
    return colEntries;
  }

  private static async readdirSafe(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  private static async isDir(p: string): Promise<boolean> {
    try {
      const stat = await fs.stat(p);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
