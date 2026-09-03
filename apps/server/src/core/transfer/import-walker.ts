import fs from "fs/promises";
import path from "path";
import { ValidationError } from "@silo/shared/validation-error";
// The fs layout *is* the archive format (D5), so the file and marker names come
// from the one place that grammar is stated.
import { FsLayout } from "../../adapters/storage/fs/fs-layout";
import type { Entry } from "../domain/entry";
import { Scope } from "../domain/scope";

export interface ScopedImport {
  scope: Scope;
  schemas: Map<string, any>;
  entries: Map<string, Entry[]>;
  /** The environment's own id from its marker, when the archive carried one
   *  (D51). Absent for a hand-assembled tree, and then minted locally. */
  envId?: string;
  /** Collection ids from the markers beside each schema, by collection name. */
  collectionIds: Map<string, string>;
}

/** A project the archive names, whether or not it holds any environment. */
export interface ImportedProject {
  name: string;
  id?: string;
}

export interface WalkedArchive {
  /** Every project directory, so one holding no environment still travels —
   *  `scopes` is (project, env) pairs and cannot represent it (D51). */
  projects: ImportedProject[];
  scopes: ScopedImport[];
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
  static async walkProjects(src: string): Promise<WalkedArchive> {
    const projectsDir = path.join(src, "projects");
    const projects: ImportedProject[] = [];
    const scopes: ScopedImport[] = [];

    for (const p of await ImportWalker.readdirSafe(projectsDir)) {
      if (p.startsWith(".")) continue;
      const projectPath = path.join(projectsDir, p);
      if (!(await ImportWalker.isDir(projectPath))) continue;

      projects.push({
        name: p,
        id: await ImportWalker.markerId(path.join(projectPath, FsLayout.ProjectMarker)),
      });

      for (const e of await ImportWalker.readdirSafe(projectPath)) {
        if (e.startsWith(".")) continue;
        const envPath = path.join(projectPath, e);
        if (!(await ImportWalker.isDir(envPath))) continue;

        const scope = p === Scope.System.project && e === Scope.System.env
          ? Scope.System
          : Scope.of(p, e);

        const schemas = new Map<string, any>();
        const collectionIds = new Map<string, string>();
        const entries = new Map<string, Entry[]>();
        await ImportWalker.walkSchemas(envPath, schemas, collectionIds);
        await ImportWalker.walkContent(envPath, scope, entries);
        ImportWalker.assertSchemasPresent(scope, schemas, entries);

        scopes.push({
          scope,
          schemas,
          entries,
          collectionIds,
          envId: await ImportWalker.markerId(path.join(envPath, FsLayout.EnvMarker)),
        });
      }
    }
    return { projects, scopes };
  }

  /**
   * A collection's schema is not optional (D51).
   *
   * An archive could carry `content/<name>/` with no `schemas/` counterpart,
   * and silo used to accept it — `listEntryCollections` existed so those
   * entries stayed addressable. A collection record's schema is `NOT NULL` now,
   * so the state is unrepresentable, and inventing a permissive
   * `{"type":"object"}` to satisfy the column would silently accept anything
   * into a collection the operator believes is validated. So it is refused, by
   * name.
   */
  private static assertSchemasPresent(
    scope: Scope,
    schemas: Map<string, any>,
    entries: Map<string, Entry[]>
  ): void {
    const missing = [...entries.keys()].filter((name) => !schemas.has(name)).sort();
    if (missing.length === 0) return;

    throw new ValidationError(
      `this archive has content with no schema in "${scope.key()}": ${missing
        .map((name) => `content/${name}/`)
        .join(", ")} — every collection needs its schemas/<name>.schema.json`
    );
  }

  private static async walkSchemas(
    scopeDir: string,
    schemas: Map<string, any>,
    collectionIds: Map<string, string>
  ): Promise<void> {
    const schemasDir = path.join(scopeDir, "schemas");
    for (const f of await ImportWalker.readdirSafe(schemasDir)) {
      if (f.startsWith(".") || !f.endsWith(FsLayout.SchemaSuffix)) continue;
      const name = f.slice(0, -FsLayout.SchemaSuffix.length);
      const data = await fs.readFile(path.join(schemasDir, f), "utf8");
      schemas.set(name, JSON.parse(data));

      const id = await ImportWalker.markerId(
        path.join(schemasDir, `.${name}${FsLayout.CollectionMarkerSuffix}`)
      );
      if (id !== undefined) collectionIds.set(name, id);
    }
  }

  /**
   * A record's id from its marker, or undefined.
   *
   * Undefined rather than an error for a missing or unreadable marker: a
   * hand-assembled directory tree is a supported way to import, so an id is
   * preserved when the archive carries one and minted locally when it does not.
   */
  private static async markerId(filePath: string): Promise<string | undefined> {
    try {
      const document = JSON.parse(await fs.readFile(filePath, "utf8"));
      return typeof document?.id === "string" && document.id.length > 0
        ? document.id
        : undefined;
    } catch {
      return undefined;
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
