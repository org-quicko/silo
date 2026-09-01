import fs from "fs/promises";
import path from "path";
import type { CollectionRecord } from "../../../core/domain/collection-record";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Scope } from "../../../core/domain/scope";
import { ConflictError } from "../../../core/errors/conflict-error";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";
import { FsMarker, type FsMarkerData } from "./fs-marker";
import type { FsScopeStore } from "./fs-scope-store";

/**
 * Collections: a `<collection>.schema.json` and the marker beside it that
 * carries the record id (D51).
 *
 * A rename here is not one syscall the way a project's is — the marker, the
 * schema and the content directory are three moves — so it runs as phases with
 * the destination marker holding `moving_from` as its durable state. Recovery
 * is decidable because the id is in both places: a destination marker naming a
 * source is *this* rename half-finished, not a collision with something else.
 */
export class FsCollectionStore {
  private readonly layout: FsLayout;
  private readonly scopes: FsScopeStore;

  constructor(layout: FsLayout, scopes: FsScopeStore) {
    this.layout = layout;
    this.scopes = scopes;
  }

  /**
   * The schema is written **before** the marker.
   *
   * A crash between the two then leaves a schema file no listing reports, which
   * the next put adopts — where the other order would leave a collection that
   * lists but has no schema, the one state the `NOT NULL` invariant exists to
   * rule out.
   */
  async put(
    scope: Scope,
    collection: string,
    schema: any,
    id?: string
  ): Promise<CollectionRecord> {
    EntryUtils.assertSafeSegment(collection, "collection");
    const environment = await this.scopes.ensureScope(scope);

    await FsFiles.writeAtomic(
      this.layout.schemaFile(scope, collection),
      JSON.stringify(schema, null, 2)
    );
    const marker = await FsMarker.write(
      this.layout.collectionMarkerFile(scope, collection),
      await this.claimId(id)
    );

    return {
      id: marker.id,
      project_id: environment.project_id,
      env_id: environment.id,
      name: collection,
      schema,
      created_at: marker.created_at,
      updated_at: marker.created_at,
    };
  }

  async get(scope: Scope, collection: string): Promise<any> {
    const record = await this.find(scope, collection);
    if (!record) throw FsCollectionStore.notFound(scope, collection);
    return record.schema;
  }

  async list(scope: Scope): Promise<CollectionRecord[]> {
    const environment = await this.scopes.findEnvironment(scope.project, scope.env);
    if (!environment) return [];

    const records: CollectionRecord[] = [];
    for (const name of await this.collectionNames(scope)) {
      const record = await this.read(scope, name, environment.project_id, environment.id);
      if (record) records.push(record);
    }
    return records.sort((left, right) => left.name.localeCompare(right.name));
  }

  async find(scope: Scope, collection: string): Promise<CollectionRecord | null> {
    const environment = await this.scopes.findEnvironment(scope.project, scope.env);
    if (!environment) return null;
    return this.read(scope, collection, environment.project_id, environment.id);
  }

  async rename(id: string, name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "collection");

    const found = await this.byId(id);
    if (found.record.name === name) return;

    const destination = await FsMarker.read(
      this.layout.collectionMarkerFile(found.scope, name)
    );
    // A destination marker holding *this* id is this rename, already begun. Any
    // other id is a genuine collision.
    if (destination && destination.id !== id) {
      throw new ConflictError(`collection "${name}" already exists in this environment`);
    }

    await FsMarker.replace(this.layout.collectionMarkerFile(found.scope, name), {
      id,
      created_at: found.record.created_at,
      moving_from: found.record.name,
    });
    await this.finishMove(found.scope, found.record.name, name, id, found.record.created_at);
  }

  /**
   * Removes the record: the schema, its marker, and the content directory if it
   * is empty. Entries have to be gone first, which is what the caller's own
   * erase loop guarantees.
   */
  async delete(scope: Scope, collection: string): Promise<void> {
    const markerFile = this.layout.collectionMarkerFile(scope, collection);
    const schemaFile = this.layout.schemaFile(scope, collection);
    if (!(await FsFiles.exists(markerFile)) && !(await FsFiles.exists(schemaFile))) {
      throw FsCollectionStore.notFound(scope, collection);
    }

    await fs.rm(markerFile, { force: true });
    await fs.rm(schemaFile, { force: true });
    await fs.rm(this.layout.collectionDir(scope, collection), { force: true }).catch(() => {});
  }

  /**
   * Finishes any rename a crash left half-applied, at open.
   *
   * Failures are counted rather than thrown, on the same reasoning D23's and
   * D49's resumes give: a move staged days ago must not stop the process
   * starting. The scan is the whole tree, which this adapter already does once
   * at open to repair `last_seq`.
   */
  async resumePending(): Promise<number> {
    let resumed = 0;
    for (const scope of await this.scopes.listScopes()) {
      for (const name of await this.markerNames(scope)) {
        const marker = await FsMarker.read(this.layout.collectionMarkerFile(scope, name));
        if (!marker || marker.moving_from === undefined) continue;

        try {
          await this.finishMove(scope, marker.moving_from, name, marker.id, marker.created_at);
          resumed++;
        } catch {
          continue;
        }
      }
    }
    return resumed;
  }

  /**
   * Phases 2 to 4: move the schema, move the content, drop the old marker, then
   * clear `moving_from` so nothing resumes it again.
   *
   * Each step is skipped when it has already happened, which is what makes a
   * replay converge rather than fail on its own previous work.
   */
  private async finishMove(
    scope: Scope,
    from: string,
    to: string,
    id: string,
    created: Date
  ): Promise<void> {
    await FsCollectionStore.moveIfPresent(
      this.layout.schemaFile(scope, from),
      this.layout.schemaFile(scope, to)
    );
    await FsCollectionStore.moveIfPresent(
      this.layout.collectionDir(scope, from),
      this.layout.collectionDir(scope, to)
    );
    await fs.rm(this.layout.collectionMarkerFile(scope, from), { force: true });
    await FsMarker.replace(this.layout.collectionMarkerFile(scope, to), {
      id,
      created_at: created,
    });
  }

  private static async moveIfPresent(from: string, to: string): Promise<void> {
    if (!(await FsFiles.exists(from))) return;
    if (await FsFiles.exists(to)) {
      // The move already landed and the source is a leftover the previous
      // attempt did not get to remove.
      await fs.rm(from, { recursive: true, force: true });
      return;
    }
    await fs.rename(from, to);
  }

  private async read(
    scope: Scope,
    collection: string,
    projectId: string,
    envId: string
  ): Promise<CollectionRecord | null> {
    const marker = await FsMarker.read(this.layout.collectionMarkerFile(scope, collection));
    if (!marker) return null;

    const schema = await FsFiles.readJsonOrNull(this.layout.schemaFile(scope, collection));
    if (schema === null) return null;

    return {
      id: marker.id,
      project_id: projectId,
      env_id: envId,
      name: collection,
      schema,
      created_at: marker.created_at,
      updated_at: marker.created_at,
    };
  }

  /** Every name with a marker, from the schemas directory. */
  private async markerNames(scope: Scope): Promise<string[]> {
    const names: string[] = [];
    for (const entry of await FsFiles.readDirents(this.layout.schemasDir(scope))) {
      const name = FsLayout.collectionOfMarkerFile(entry.name);
      if (name !== null) names.push(name);
    }
    return names;
  }

  /** Marker names, plus schema files that have no marker yet, so an adopted
   *  orphan is not invisible to the next put. */
  private async collectionNames(scope: Scope): Promise<string[]> {
    return [...new Set(await this.markerNames(scope))];
  }

  private async byId(id: string): Promise<{ scope: Scope; record: CollectionRecord }> {
    for (const scope of await this.scopes.listScopes()) {
      for (const record of await this.list(scope)) {
        if (record.id === id) return { scope, record };
      }
    }
    throw new NotFoundError(`no collection with id "${id}"`);
  }

  private async claimId(id: string | undefined): Promise<string> {
    if (id === undefined) return EntryUtils.newID();
    EntryUtils.assertSafeSegment(id, "collection id");
    if (id.startsWith("_")) {
      throw new ConflictError(`record id "${id}" is reserved`);
    }

    for (const scope of await this.scopes.listScopes()) {
      for (const record of await this.list(scope)) {
        if (record.id === id) throw new ConflictError(`record id "${id}" is already in use`);
      }
    }
    return id;
  }

  private static notFound(scope: Scope, collection: string): NotFoundError {
    return new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
  }
}
