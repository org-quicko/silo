import type { Storage } from "../ports/storage";
import type { BlobStorage } from "../ports/blob-storage";
import { Claims } from "@silo/shared/claims";
import { KeyFormat } from "@silo/shared/key-format";
import { SchemaAccess } from "@silo/shared/schema-access";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { MimeUtils } from "../media/mime-utils";
import { SchemaValidator, type SchemaValidatorOptions } from "../schema/schema-validator";
import { EntryUtils } from "../domain/entry-utils";
import type { Entry } from "../domain/entry";
import type { Meta } from "../domain/meta";
import { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import { ValidationError } from "@silo/shared/validation-error";
import { KeyUtils } from "../keys/key-utils";
import type { KeyInfo } from "../keys/key-info";
import { QueryUtils } from "../query/query-utils";
import type { Query } from "../query/query";
import { Exporter } from "../transfer/exporter";
import type { ExportOptions } from "../transfer/export-options";
import { Importer } from "../transfer/importer";
import type { ImportOptions } from "../transfer/import-options";
import type { ImportResult } from "../transfer/import-result";
import { CollectionEraser } from "./collection-eraser";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import { SchemaBundler } from "../schema/schema-bundler";
import type { Collection } from "../domain/collection";
import type { KeyView } from "./key-view";
import type { MediaMetadata } from "../media/media-metadata";
import { AsyncMutex } from "./async-mutex";

/** A collection in a scope, with its entry count. */
interface ScopeCollection {
  name: string;
  total: number;
}

export class Service {
  public store: Storage;
  public blobStore: BlobStorage;
  private schemas: SchemaValidator;
  private writeMu = new AsyncMutex();
  private publicScopeCache: Map<string, Set<string>> | null = null;

  constructor(
    store: Storage,
    schemaOpts: SchemaValidatorOptions & { mediaDir?: string; blobStore?: BlobStorage } = {}
  ) {
    this.store = store;
    this.schemas = new SchemaValidator(store, schemaOpts);
    if (schemaOpts.blobStore) {
      this.blobStore = schemaOpts.blobStore;
    } else {
      const mediaDir = schemaOpts.mediaDir || "./silo_data/media";
      this.blobStore = new FsBlobStorage(mediaDir);
    }
  }


  static newKeyView(e: Entry): KeyView {
    const info = e.data as KeyInfo;
    return {
      id: e.id,
      label: info.label,
      claims: Claims.normalize(info.claims),
      prefix: info.prefix,
      created_at: typeof e.created_at === "string" ? e.created_at : e.created_at.toISOString(),
    };
  }

  async meta(): Promise<Meta> {
    return this.store.meta();
  }

  // ---- Defaults & Scopes / Projects / Environments ----

  /**
   * The default project/env come from configuration (`--project`/`--env`, the
   * TOML file, or `SILO_DEFAULT_*`), so they are caller-supplied ids and get
   * the same validation every other id gets. Skipping it here used to create a
   * scope that no route could address (`Scope.of` rejects it at the HTTP
   * boundary) and that `deleteProject` then refused to delete for the same
   * reason — an unreachable, unremovable project, produced by a typo in an
   * env var. Failing at startup instead makes the typo obvious.
   */
  async initDefaults(defaultProject: string = "default", defaultEnv: string = "prod"): Promise<void> {
    let scope: Scope;
    try {
      scope = Scope.of(defaultProject, defaultEnv);
    } catch (err) {
      throw new ValidationError(
        `invalid default scope in configuration (--project/--env, default_project/default_env, or SILO_DEFAULT_PROJECT/SILO_DEFAULT_ENV): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const release = await this.writeMu.acquire();
    try {
      await this.store.createProject(scope.project);
      await this.store.createEnvironment(scope.project, scope.env);
    } finally {
      release();
    }
  }

  async listProjects(): Promise<string[]> {
    return this.store.listProjects();
  }

  async createProject(project: string): Promise<void> {
    Scope.validateProject(project);
    const release = await this.writeMu.acquire();
    try {
      await this.store.createProject(project);
    } finally {
      release();
    }
  }

  async deleteProject(project: string, force: boolean): Promise<void> {
    Scope.validateProject(project);
    const release = await this.writeMu.acquire();
    try {
      // Every env is inspected before any of them is touched: checking and
      // erasing env by env would empty the first environments in the list
      // before discovering that a later one still holds content, leaving the
      // project half-deleted and the request reporting failure.
      const plans: { scope: Scope; collections: ScopeCollection[] }[] = [];
      for (const env of await this.store.listEnvironments(project)) {
        const scope = Scope.of(project, env);
        plans.push({ scope, collections: await this.scopeCollections(scope) });
      }

      if (!force) {
        for (const plan of plans) {
          Service.refuseNonEmpty(
            `project "${project}" environment "${plan.scope.env}"`,
            plan.collections
          );
        }
      }

      for (const plan of plans) {
        for (const col of plan.collections) {
          await CollectionEraser.erase(this.store, plan.scope, col.name);
        }
      }
      this.invalidateSchemas();
      await this.store.deleteProject(project);
    } finally {
      release();
    }
  }

  async listEnvironments(project: string): Promise<string[]> {
    Scope.validateProject(project);
    return this.store.listEnvironments(project);
  }

  async createEnvironment(project: string, env: string): Promise<Scope> {
    const scope = Scope.of(project, env);
    const release = await this.writeMu.acquire();
    try {
      await this.store.createEnvironment(project, env);
      return scope;
    } finally {
      release();
    }
  }

  async deleteEnvironment(project: string, env: string, force: boolean): Promise<void> {
    const scope = Scope.of(project, env);
    const release = await this.writeMu.acquire();
    try {
      const collections = await this.scopeCollections(scope);
      if (!force) {
        Service.refuseNonEmpty(`environment "${scope.key()}"`, collections);
      }
      for (const col of collections) {
        await CollectionEraser.erase(this.store, scope, col.name);
      }
      this.invalidateSchemas();
      await this.store.deleteEnvironment(project, env);
    } finally {
      release();
    }
  }

  /**
   * Every collection in `scope`, from both sides of the schema/entry split,
   * with each one's entry count.
   */
  private async scopeCollections(scope: Scope): Promise<ScopeCollection[]> {
    const names = [
      ...new Set([
        ...(await this.store.listSchemas(scope)).keys(),
        ...(await this.store.listEntryCollections(scope)),
      ]),
    ].sort();

    const collections: ScopeCollection[] = [];
    for (const name of names) {
      const { total } = await this.store.list(scope, name, { limit: 1, offset: 0 });
      collections.push({ name, total });
    }
    return collections;
  }

  /**
   * `force` guards the collections themselves, not just their rows. Gating on
   * entry counts alone let an un-forced delete destroy every schema in a
   * scope — a project holding twenty collection definitions and no content yet
   * is exactly the state a project is in right after it is set up, and losing
   * it to an un-forced call reported as `204` is not a recoverable mistake.
   */
  private static refuseNonEmpty(subject: string, collections: ScopeCollection[]): void {
    if (collections.length === 0) {
      return;
    }
    const listed = collections.map((col) => `"${col.name}" (${col.total})`).join(", ");
    throw new ConflictError(
      `${subject} still has collections (name and entry count): ${listed}; delete them or pass force`
    );
  }

  async listScopes(): Promise<Scope[]> {
    return this.store.listScopes();
  }

  /**
   * Which scopes expose at least one collection readable without a key, as
   * `project -> envs`.
   *
   * Anonymous project and env discovery needs this, and computing it means
   * reading every schema in the instance — an unauthenticated request that
   * would otherwise walk every project × env × schema on each call, with the
   * fs adapter re-reading every schema file each time. It is derived once and
   * held until the next schema write, alongside the compiled-validator cache
   * and invalidated by the same calls.
   */
  async publicScopes(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    if (this.publicScopeCache) {
      return this.publicScopeCache;
    }
    const found = new Map<string, Set<string>>();
    for (const scope of await this.store.listScopes()) {
      const cols = await this.listCollections(scope);
      if (!cols.some((col) => !SchemaAccess.requiresAuth(col.schema))) {
        continue;
      }
      const envs = found.get(scope.project);
      if (envs) {
        envs.add(scope.env);
      } else {
        found.set(scope.project, new Set([scope.env]));
      }
    }
    this.publicScopeCache = found;
    return found;
  }

  /** Drops every cache derived from schema content. */
  private invalidateSchemas(): void {
    this.schemas.invalidate();
    this.publicScopeCache = null;
  }

  // ---- Collections ----

  async listCollections(scope: Scope): Promise<Collection[]> {
    const all = await this.store.listSchemas(scope);
    const cols: Collection[] = [];
    for (const [name, schema] of all.entries()) {
      if (EntryUtils.isSystemCollection(name)) {
        continue;
      }
      cols.push({ name, schema });
    }
    cols.sort((a, b) => a.name.localeCompare(b.name));
    return cols;
  }

  async getCollection(scope: Scope, name: string): Promise<Collection> {
    if (EntryUtils.isSystemCollection(name)) {
      throw new NotFoundError(`collection "${scope.key()}/${name}" not found`);
    }
    const schema = await this.store.getSchema(scope, name);
    return { name, schema };
  }

  async putSchema(scope: Scope, name: string, schema: any): Promise<Collection> {
    if (!Claims.isCollectionName(name)) {
      throw new ValidationError(
        `invalid collection name "${name}": want lowercase letter first, then [a-z0-9_-], max 64 chars`
      );
    }
    const bundledSchema = await SchemaBundler.bundle(
      scope,
      schema,
      this.store,
      this.schemas.getRemoteLoader(),
      this.schemas.getAllowRemoteRefs()
    );
    await this.schemas.checkSchemaDoc(scope, name, bundledSchema);

    const release = await this.writeMu.acquire();
    try {
      await this.store.putSchema(scope, name, bundledSchema);
      this.invalidateSchemas();
      return { name, schema: bundledSchema };
    } finally {
      release();
    }
  }

  async deleteCollection(scope: Scope, name: string, force: boolean): Promise<void> {
    if (EntryUtils.isSystemCollection(name)) {
      throw new NotFoundError(`collection "${scope.key()}/${name}" not found`);
    }

    const release = await this.writeMu.acquire();
    try {
      // Ensure schema exists
      await this.store.getSchema(scope, name);

      const { total } = await this.store.list(scope, name, { limit: 1, offset: 0 });
      if (total > 0 && !force) {
        throw new ConflictError(
          `collection "${name}" has ${total} entries; delete them or pass force`
        );
      }

      // Deleting a collection that another schema $ref would break every write
      // to the referencing collections, so refuse unless forced. Only
      // referrers in the same scope are considered — cross-scope $refs are
      // not supported.
      if (!force) {
        const referrers = await this.findSchemaReferrers(scope, name);
        if (referrers.length > 0) {
          throw new ConflictError(
            `collection "${name}" is referenced by schema${referrers.length === 1 ? "" : "s"} ${referrers.map((r) => `"${r}"`).join(", ")}; remove the $ref or pass force`
          );
        }
      }

      await CollectionEraser.erase(this.store, scope, name);
      this.invalidateSchemas();
    } finally {
      release();
    }
  }

  // findSchemaReferrers lists collections in the same scope whose schema
  // contains a $ref to the given collection (silo://collections/<name>, with
  // or without a fragment).
  private async findSchemaReferrers(scope: Scope, name: string): Promise<string[]> {
    const url = SchemaValidator.schemaURL(name);
    const all = await this.store.listSchemas(scope);
    const referrers: string[] = [];
    for (const [other, schema] of all.entries()) {
      if (other === name) {
        continue;
      }
      if (Service.schemaRefsURL(schema, url)) {
        referrers.push(other);
      }
    }
    return referrers.sort();
  }

  private static schemaRefsURL(node: any, url: string): boolean {
    if (Array.isArray(node)) {
      return node.some((v) => Service.schemaRefsURL(v, url));
    }
    if (!node || typeof node !== "object") {
      return false;
    }
    const ref = node.$ref;
    if (typeof ref === "string" && (ref === url || ref.startsWith(url + "#"))) {
      return true;
    }
    return Object.values(node).some((v) => Service.schemaRefsURL(v, url));
  }

  // ---- Entries ----

  private async requireUserCollection(scope: Scope, collection: string): Promise<void> {
    if (EntryUtils.isSystemCollection(collection)) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
    await this.store.getSchema(scope, collection);
  }

  async createEntry(scope: Scope, collection: string, data: any): Promise<Entry> {
    await this.requireUserCollection(scope, collection);
    await this.schemas.validateEntry(scope, collection, data);

    const now = EntryUtils.now();
    const e: Entry = {
      id: EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection: collection,
      rev: 1,
      seq: 0, // Assigned by storage adapter
      created_at: now,
      updated_at: now,
      data,
    };

    const release = await this.writeMu.acquire();
    try {
      await this.store.put(e);
      return e;
    } finally {
      release();
    }
  }

  async getEntry(scope: Scope, collection: string, id: string): Promise<Entry> {
    if (EntryUtils.isSystemCollection(collection)) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
    return this.store.get(scope, collection, id);
  }

  async listEntries(
    scope: Scope,
    collection: string,
    q: Partial<Query>
  ): Promise<{ items: Entry[]; total: number; limit: number; offset: number }> {
    await this.requireUserCollection(scope, collection);
    const normalized = QueryUtils.normalizeQuery(q);
    const res = await this.store.list(scope, collection, normalized);
    return {
      items: res.items,
      total: res.total,
      limit: normalized.limit,
      offset: normalized.offset,
    };
  }

  async updateEntry(
    scope: Scope,
    collection: string,
    id: string,
    data: any,
    expectedRev: number
  ): Promise<Entry> {
    await this.requireUserCollection(scope, collection);
    await this.schemas.validateEntry(scope, collection, data);

    const release = await this.writeMu.acquire();
    try {
      const cur = await this.store.get(scope, collection, id);
      if (cur.rev !== expectedRev) {
        throw new ConflictError(
          `rev mismatch: expected ${expectedRev}, current is ${cur.rev}`
        );
      }

      const e: Entry = {
        ...cur,
        rev: cur.rev + 1,
        updated_at: EntryUtils.now(),
        data,
      };

      await this.store.put(e);
      return e;
    } finally {
      release();
    }
  }

  async deleteEntry(
    scope: Scope,
    collection: string,
    id: string,
    expectedRev: number
  ): Promise<void> {
    if (EntryUtils.isSystemCollection(collection)) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }

    const release = await this.writeMu.acquire();
    try {
      const cur = await this.store.get(scope, collection, id);
      if (cur.rev !== expectedRev) {
        throw new ConflictError(
          `rev mismatch: expected ${expectedRev}, current is ${cur.rev}`
        );
      }
      await this.store.delete(scope, collection, id);
    } finally {
      release();
    }
  }

  // ---- Keys ----
  // Keys are instance-wide, not per-project/env, so every key method uses
  // the reserved system scope internally rather than accepting one from the
  // caller (D18).

  async createKey(
    label: string,
    claims: string[]
  ): Promise<{ secret: string; entry: Entry }> {
    const keyLabel = typeof label === "string" && label.trim() ? label.trim() : "API key";
    const { secret, info } = KeyUtils.generateKey(keyLabel, claims);
    const now = EntryUtils.now();
    const e: Entry = {
      id: EntryUtils.newID(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: KeyUtils.KeysCollection,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: info,
    };

    const release = await this.writeMu.acquire();
    try {
      await this.store.put(e);
      return { secret, entry: e };
    } finally {
      release();
    }
  }

  async listKeys(): Promise<Entry[]> {
    const res = await this.store.list(Scope.System, KeyUtils.KeysCollection, {
      sort: [{ field: "$created_at", desc: false }],
      limit: 500,
      offset: 0,
    });
    return res.items.filter((entry) => {
      try {
        Claims.normalize((entry.data as KeyInfo).claims);
        return true;
      } catch (error) {
        if (ValidationError.is(error)) return false;
        throw error;
      }
    });
  }

  async revokeKey(id: string): Promise<void> {
    const release = await this.writeMu.acquire();
    try {
      await this.store.delete(Scope.System, KeyUtils.KeysCollection, id);
    } finally {
      release();
    }
  }

  async authenticate(secret: string): Promise<KeyInfo> {
    if (!KeyFormat.looksLikeKey(secret)) {
      throw new ValidationError("unauthorized: invalid API key format");
    }
    const hash = KeyUtils.hashKey(secret);
    const res = await this.store.list(Scope.System, KeyUtils.KeysCollection, {
      filter: { op: "eq", field: "hash", value: hash },
      limit: 1,
      offset: 0,
    });
    if (res.items.length === 0) {
      throw new ValidationError("unauthorized: invalid API key");
    }
    const info = res.items[0].data as KeyInfo;
    return { ...info, claims: Claims.normalize(info.claims) };
  }

  async bootstrap(): Promise<string> {
    if ((await this.listKeys()).length > 0) {
      return "";
    }
    const { secret } = await this.createKey("root", [Claims.Root]);
    return secret;
  }

  // ---- Export / Import ----
  // Instance-wide: every scope (including _system, per --with-keys) is
  // exported/imported in one pass. Scoped export/import is a later phase.

  async exportDir(dest: string, opts: ExportOptions): Promise<void> {
    await Exporter.exportDir(this.store, dest, opts, this.blobStore);
  }

  async exportTarGz(w: WritableStreamDefaultWriter<any> | any, opts: ExportOptions): Promise<void> {
    await Exporter.exportTarGz(this.store, w, opts, this.blobStore);
  }

  async importDir(src: string, opts: ImportOptions): Promise<ImportResult> {
    const release = await this.writeMu.acquire();
    try {
      const res = await Importer.importDir(this.store, src, opts, this.blobStore);
      this.invalidateSchemas();
      return res;
    } finally {
      release();
    }
  }

  async importTarGz(r: ReadableStream | any, opts: ImportOptions): Promise<ImportResult> {
    const release = await this.writeMu.acquire();
    try {
      const res = await Importer.importTarGz(this.store, r, opts, this.blobStore);
      this.invalidateSchemas();
      return res;
    } finally {
      release();
    }
  }

  // ---- Media ----
  // Instance-global, not scoped (media stays a later-phase concern).

  async listMedia(): Promise<MediaMetadata[]> {
    const items = await this.blobStore.list();
    const results: MediaMetadata[] = [];
    for (const item of items) {
      const splitIdx = item.key.indexOf("_");
      if (splitIdx === -1) continue;
      const hash = item.key.substring(0, splitIdx);
      const filename = item.key.substring(splitIdx + 1);
      results.push({
        hash,
        filename,
        size: item.size,
        url: `/media/${item.key}`,
        created_at: item.lastModified ? item.lastModified.toISOString() : new Date().toISOString(),
      });
    }
    return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async saveMedia(originalName: string, fileData: Uint8Array, mimeType?: string): Promise<MediaMetadata> {
    const hash = crypto.createHash("sha256").update(fileData).digest("hex");
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const cleanBaseName = baseName
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9.-]/g, "")
      .toLowerCase();
    const cleanExt = ext.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
    const cleanName = `${cleanBaseName}${cleanExt}`;
    const diskName = `${hash}_${cleanName}`;
    const contentType = mimeType || MimeUtils.lookup(originalName);
    await this.blobStore.put(diskName, fileData, { contentType });
    return {
      hash,
      filename: cleanName,
      size: fileData.length,
      url: `/media/${diskName}`,
      created_at: new Date().toISOString(),
    };
  }

  async getMedia(diskFilename: string): Promise<{ data: Uint8Array; contentType?: string; size: number } | null> {
    if (diskFilename.includes("..") || diskFilename.includes("/") || diskFilename.includes("\\")) {
      throw new ValidationError("invalid filename");
    }
    return await this.blobStore.get(diskFilename);
  }

  async deleteMedia(diskFilename: string): Promise<void> {

    if (diskFilename.includes("..") || diskFilename.includes("/") || diskFilename.includes("\\")) {
      throw new ValidationError("invalid filename");
    }
    const exists = await this.blobStore.exists(diskFilename);
    if (!exists) {
      throw new NotFoundError(`media file "${diskFilename}" not found`);
    }
    await this.blobStore.delete(diskFilename);
  }
}
