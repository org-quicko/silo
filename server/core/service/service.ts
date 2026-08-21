import type { Storage } from "../ports/storage";
import type { BlobStorage } from "../ports/blob-storage";
import { Claims } from "@silo/shared/claims";
import { KeyFormat } from "@silo/shared/key-format";
import { SchemaAccess } from "@silo/shared/schema-access";
import { SearchFields } from "@silo/shared/search-fields";
import type { Searcher } from "../search/searcher";
import type { SearchAccess } from "../search/search-access";
import type { SearchRequest } from "../search/search-request";
import type { SearchResult } from "../search/search-result";
import type { SearchTarget } from "../search/search-target";
import type { SearchIntegrity } from "../search/search-integrity";
import { ScanSearcher } from "../search/scan-searcher";
import { SearchText } from "../search/search-text";
import type { DerivedIndex } from "../ports/derived-index";
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
import type { Filter } from "../query/filter";
import { Exporter } from "../transfer/exporter";
import type { ExportOptions } from "../transfer/export-options";
import { Importer } from "../transfer/importer";
import type { ImportOptions } from "../transfer/import-options";
import type { ImportResult } from "../transfer/import-result";
import { ScopeCopier } from "../transfer/scope-copier";
import type { ScopeCopyOptions } from "../transfer/scope-copy-options";
import { CollectionEraser } from "./collection-eraser";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import { SchemaBundler } from "../schema/schema-bundler";
import type { Collection } from "../domain/collection";
import type { KeyView } from "./key-view";
import { MediaCatalog } from "../media/media-catalog";
import { MediaPaths } from "../media/media-paths";
import { MediaRefs } from "../media/media-refs";
import { MediaInUseError } from "../errors/media-in-use-error";
import { MediaDeleteStalledError } from "../errors/media-delete-stalled-error";
import { MediaRef } from "@silo/shared/media-ref";
import type { MediaAsset } from "../media/media-asset";
import type { MediaAssetView } from "../media/media-asset-view";
import type { MediaFolder } from "../media/media-folder";
import type { MediaQuery } from "../media/media-query";
import type { MediaReconcileResult } from "../media/media-reconcile-result";
import type { MediaUsage } from "../media/media-usage";
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

  private readonly searcher: Searcher;

  constructor(
    store: Storage,
    schemaOpts: SchemaValidatorOptions & {
      mediaDir?: string;
      blobStore?: BlobStorage;
      searcher?: Searcher;
      /** Bounds for the portable engine; ignored when a native one is given. */
      scan?: { visitLimit?: number; timeBudgetMs?: number };
    } = {}
  ) {
    this.store = store;
    this.schemas = new SchemaValidator(store, schemaOpts);
    // The portable engine is the default rather than an absence, so search
    // works on every adapter without wiring (D30). A native engine is passed
    // in when the adapter has one.
    this.searcher = schemaOpts.searcher ?? new ScanSearcher(store, schemaOpts.scan ?? {});
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
    // Checked on save, so a mistyped search path is a 400 the author sees now
    // rather than a field that quietly stops being searchable — the kind of
    // failure nobody reports, because nothing looks broken (D30).
    SearchFields.validate(schema);
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
    // Canonicalised **before** validation, so the schema judges exactly the
    // value that will be stored. Reads resolve media fields into absolute
    // URLs, so a client that PUTs back what it fetched would otherwise store
    // a URL where a reference belongs — quietly turning a counted reference
    // into an uncounted string (D23).
    data = MediaRefs.canonicalize(data);
    await this.schemas.validateEntry(scope, collection, data);

    const usages = MediaRefs.extract(data);

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
      // Under the lock, not before it: `deleteMedia` counts usages while
      // holding the same mutex, so a check outside it could pass, lose the
      // race to a delete, and then write a reference to bytes that are
      // already gone.
      await this.assertMediaReferencable(usages);
      await this.store.put(e, await this.derived(scope, collection, data, usages));
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

  /**
   * The derived state a write carries into the adapter's transaction (D23,
   * D30). The schema is fetched here because the extractor needs it and no
   * adapter may have one; a collection without a schema still indexes, just
   * without weighting.
   */
  private async derived(
    scope: Scope,
    collection: string,
    data: any,
    usages: string[]
  ): Promise<DerivedIndex> {
    let schema: any;
    try {
      schema = await this.store.getSchema(scope, collection);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    return { usages, search: SearchText.extract(data, schema) };
  }

  // ---- Search (D30) ----

  /**
   * Compile what this caller may search into concrete targets, **before** the
   * query runs. Post-filtering results would leave `total` and every page
   * boundary wrong, and the engine must never see a claim string — the claim
   * grammar belongs to `@silo/shared`, and a second parser of it is a second
   * enforcement point that can disagree with the first.
   *
   * `claims` is `null` for an anonymous request. That case cannot be expressed
   * as claim-derived targets at all: readability comes from the schema's
   * `x-silo-auth`, so the public collections are enumerated and expanded here.
   * The count is bounded by how many collections exist, which is small.
   */
  async searchAccess(
    claims: readonly string[] | null,
    reach: { project?: string; env?: string; collection?: string } = {}
  ): Promise<SearchAccess> {
    if (claims === null) return { targets: await this.publicTargets(reach) };

    const targets: SearchTarget[] = [];
    for (const raw of claims) {
      // A stored key is validated when it is minted (D12), but a hand-edited
      // or imported record need not be. Skipping an unparseable claim narrows
      // what the caller can reach; throwing would turn one bad record into a
      // 500 on every search.
      let parsed;
      try {
        parsed = Claims.parse(raw);
      } catch {
        continue;
      }
      if (parsed.kind === "root") {
        const all = Service.intersect({ project: "*", env: "*", collection: "*" }, reach);
        if (all) targets.push(all);
        continue;
      }
      if (parsed.kind !== "collection") continue;
      if (parsed.permission !== Claims.CollectionEntriesRead) continue;

      const target = Service.intersect(
        { project: parsed.project!, env: parsed.env!, collection: parsed.name! },
        reach
      );
      if (target) targets.push(target);
    }
    return { targets };
  }

  async search(request: SearchRequest, access: SearchAccess): Promise<SearchResult> {
    const normalized = QueryUtils.normalizeQuery({
      filter: request.filter,
      sort: request.sort,
      limit: request.limit,
      offset: request.offset,
    });
    return this.searcher.search(
      { ...request, filter: normalized.filter, sort: normalized.sort, limit: normalized.limit, offset: normalized.offset },
      access
    );
  }

  searchCapabilities(): { engine: "fts5" | "scan"; snippets: boolean } {
    return this.searcher.capabilities();
  }

  async reindexSearch(target?: SearchTarget): Promise<{ collections: number; entries: number }> {
    return this.searcher.reindex(target);
  }

  checkSearch(): SearchIntegrity | null {
    return this.searcher.check();
  }

  /**
   * Narrows a claim's target by the reach the route derived from its path. A
   * wildcard segment takes the reach's value; a named segment that disagrees
   * with the reach drops the target entirely. Both directions matter: without
   * the first, a `*` claim would search outside the collection the caller
   * asked about; without the second, a claim for another project would widen
   * a scoped search back out.
   */
  private static intersect(
    target: SearchTarget,
    reach: { project?: string; env?: string; collection?: string }
  ): SearchTarget | null {
    const seg = (claim: string, asked?: string): string | null => {
      if (asked === undefined) return claim;
      if (claim === "*") return asked;
      return claim === asked ? claim : null;
    };
    const project = seg(target.project, reach.project);
    const env = seg(target.env, reach.env);
    const collection = seg(target.collection, reach.collection);
    if (project === null || env === null || collection === null) return null;
    return { project, env, collection };
  }

  /**
   * Collections an anonymous caller may read: those with a schema that does
   * not set `x-silo-auth`. A collection with **no** schema is deliberately
   * excluded — an import archive can carry entries with no schema (§6.1), and
   * nobody has declared those public, so inferring it from an absent
   * declaration would publish content by accident.
   */
  private async publicTargets(reach: {
    project?: string;
    env?: string;
    collection?: string;
  }): Promise<SearchTarget[]> {
    const targets: SearchTarget[] = [];
    for (const scope of await this.store.listScopes()) {
      if (reach.project && scope.project !== reach.project) continue;
      if (reach.env && scope.env !== reach.env) continue;

      for (const [name, schema] of (await this.store.listSchemas(scope)).entries()) {
        if (EntryUtils.isSystemCollection(name)) continue;
        if (reach.collection && name !== reach.collection) continue;
        if (SchemaAccess.requiresAuth(schema)) continue;
        targets.push({ project: scope.project, env: scope.env, collection: name });
      }
    }
    return targets;
  }

  async updateEntry(
    scope: Scope,
    collection: string,
    id: string,
    data: any,
    expectedRev: number
  ): Promise<Entry> {
    await this.requireUserCollection(scope, collection);
    data = MediaRefs.canonicalize(data);
    await this.schemas.validateEntry(scope, collection, data);

    const usages = MediaRefs.extract(data);

    const release = await this.writeMu.acquire();
    try {
      await this.assertMediaReferencable(usages);
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

      await this.store.put(e, await this.derived(scope, collection, data, usages));
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
      await this.store.put(e, { usages: [], search: null });
      return { secret, entry: e };
    } finally {
      release();
    }
  }

  async listKeys(): Promise<Entry[]> {
    const res = await this.store.list(Scope.System, KeyUtils.KeysCollection, {
      sort: [{ path: "$.created_at", desc: false }],
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
      filter: { op: "eq", path: "$.data.hash", value: hash },
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

  /**
   * Copy one scope's schemas and entries onto another of this instance (D22).
   * Scoped, unlike the archive routines above; media is instance-global and
   * therefore not part of it.
   */
  async copyScope(from: Scope, to: Scope, opts: ScopeCopyOptions): Promise<ImportResult> {
    const release = await this.writeMu.acquire();
    try {
      const res = await ScopeCopier.copy(this.store, from, to, opts);
      this.invalidateSchemas();
      return res;
    } finally {
      release();
    }
  }

  // ---- Media (D23) ----
  //
  // Instance-global: one library for the whole server, not per project/env,
  // and `media:*` stays unscoped. Folders organise; they do not authorise.
  //
  // The catalog (`_media` in `Scope.System`) is the source of truth for
  // everything *about* a file; `BlobStorage` holds only bytes. Entries
  // reference an asset by its catalog id, so renaming a file or moving it
  // between folders rewrites no entry and touches no blob.

  private mediaScope(): Scope {
    return Scope.System;
  }

  /** The `_media` document for an asset, or a NotFoundError. */
  private async mediaEntry(id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(id, "id");
    try {
      return await this.store.get(this.mediaScope(), MediaCatalog.Collection, id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new NotFoundError(`media asset "${id}" not found`);
      }
      throw err;
    }
  }

  private async putMediaEntry(id: string, asset: MediaAsset, created?: Date): Promise<Entry> {
    const now = EntryUtils.now();
    let rev = 1;
    let createdAt = created || now;
    try {
      const cur = await this.store.get(this.mediaScope(), MediaCatalog.Collection, id);
      rev = cur.rev + 1;
      createdAt = cur.created_at instanceof Date ? cur.created_at : new Date(cur.created_at);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    const e: Entry = {
      id,
      project: this.mediaScope().project,
      env: this.mediaScope().env,
      collection: MediaCatalog.Collection,
      rev,
      seq: 0,
      created_at: createdAt,
      updated_at: now,
      data: asset,
    };
    // A catalog record holds no media reference of its own.
    await this.store.put(e, { usages: [], search: null });
    return e;
  }

  private static readonly MediaSortFields: Record<string, string> = {
    created_at: "$.created_at",
    updated_at: "$.updated_at",
    filename: "$.data.filename",
    size: "$.data.size",
  };

  private static mediaSort(sort?: string): { path: string; desc: boolean }[] {
    const raw = (sort || "-created_at").trim();
    const desc = raw.startsWith("-");
    const name = desc ? raw.slice(1) : raw;
    // `Object.hasOwn`, not a bare lookup: `name` is caller-supplied, so
    // `?sort=constructor` would otherwise find an inherited key and pass the
    // check below with a function as the "path" (the hazard `Claims`
    // documents for exactly this shape of table).
    const path = Object.hasOwn(Service.MediaSortFields, name)
      ? Service.MediaSortFields[name]
      : undefined;
    if (!path) {
      throw new ValidationError(
        `invalid media sort "${raw}"; expected one of ${Object.keys(Service.MediaSortFields).join(", ")} with an optional "-" prefix`
      );
    }
    return [{ path, desc }];
  }

  /**
   * Search the catalog. Every filter compiles to the existing Query AST, so
   * media search adds no operator that every adapter would have to carry
   * forever (§5.3), and paging comes from `Storage.list` unchanged.
   */
  async listMedia(
    opts: MediaQuery = {}
  ): Promise<{ items: MediaAssetView[]; total: number; limit: number; offset: number }> {
    const args: Filter[] = [];
    if (opts.q && opts.q.trim()) {
      args.push({ op: "contains", path: "$.data.filename", value: opts.q.trim() });
    }
    if (opts.type && opts.type.trim()) {
      args.push({ op: "contains", path: "$.data.content_type", value: opts.type.trim() });
    }
    if (opts.tag && opts.tag.trim()) {
      // `tags` is an array, and since D29 `contains` is substring-on-string
      // only — membership is `eq` over a wildcard, which also stops a tag
      // "news" from matching a stored "newsletter".
      args.push({ op: "eq", path: "$.data.tags[*]", value: opts.tag.trim() });
    }
    // A recursive folder filter can't be one AST op — `contains` on a string
    // would also match "/marketing-old" for "/marketing". Filter it after the
    // fact rather than adding a `prefix` op the fs adapter and SQLite would
    // both have to implement forever.
    const folder = opts.folder === undefined ? undefined : MediaPaths.normalizeFolder(opts.folder);
    if (folder !== undefined && !opts.recursive) {
      args.push({ op: "eq", path: "$.data.folder", value: folder });
    }

    const filter: Filter | undefined =
      args.length === 0 ? undefined : args.length === 1 ? args[0] : { op: "and", args };

    const limit = QueryUtils.normalizeQuery({ limit: opts.limit }).limit;
    const offset = Math.max(0, opts.offset || 0);
    const sort = Service.mediaSort(opts.sort);

    // A recursive filter rooted at "" matches everything, so it is no filter
    // at all — taking the in-memory path for it would load the whole catalog
    // to page the library's default view.
    if (folder && opts.recursive) {
      const res = await this.store.list(this.mediaScope(), MediaCatalog.Collection, {
        filter,
        sort,
        limit: 100000,
        offset: 0,
      });
      const within = res.items.filter((e) =>
        MediaPaths.isWithin(MediaCatalog.toAsset(e).folder, folder)
      );
      const page = within.slice(offset, offset + limit);
      return {
        items: await this.withUsageCounts(page),
        total: within.length,
        limit,
        offset,
      };
    }

    const res = await this.store.list(this.mediaScope(), MediaCatalog.Collection, {
      filter,
      sort,
      limit,
      offset,
    });
    return {
      items: await this.withUsageCounts(res.items),
      total: res.total,
      limit,
      offset,
    };
  }

  /** One `countMediaUsages` call for a whole page, not one per asset. */
  private async withUsageCounts(entries: Entry[]): Promise<MediaAssetView[]> {
    if (entries.length === 0) return [];
    const tokens: string[] = [];
    for (const e of entries) {
      tokens.push(...MediaCatalog.tokens(e.id, MediaCatalog.toAsset(e).blob_key));
    }
    const counts = await this.store.countMediaUsages(tokens);
    return entries.map((e) => {
      const asset = MediaCatalog.toAsset(e);
      let total = 0;
      for (const token of MediaCatalog.tokens(e.id, asset.blob_key)) {
        total += counts.get(token) || 0;
      }
      return MediaCatalog.toView(e, total);
    });
  }

  async getMediaAsset(id: string): Promise<MediaAssetView> {
    const e = await this.mediaEntry(id);
    const [view] = await this.withUsageCounts([e]);
    return view;
  }

  /**
   * Referrers of an asset. Instance-global media meets scoped entries here:
   * the caller gets the true total but only the rows `canRead` admits, so a
   * key confined to one project learns that a file is in use without learning
   * where (§8.1).
   */
  async listMediaUsages(
    id: string,
    opts: { limit?: number; offset?: number } = {},
    canRead?: (project: string, env: string, collection: string) => boolean
  ): Promise<{ items: MediaUsage[]; total: number; visible: number }> {
    const e = await this.mediaEntry(id);
    const tokens = MediaCatalog.tokens(e.id, MediaCatalog.toAsset(e).blob_key);
    const res = await this.store.listMediaUsages(tokens, opts);
    const items = canRead
      ? res.items.filter((u) => canRead(u.project, u.env, u.collection))
      : res.items;
    return { items, total: res.total, visible: items.length };
  }

  async saveMedia(
    originalName: string,
    fileData: Uint8Array,
    mimeType?: string,
    folder?: string
  ): Promise<MediaAssetView> {
    const filename = MediaPaths.normalizeFilename(originalName);
    const normalizedFolder = MediaPaths.normalizeFolder(folder);
    const hash = crypto.createHash("sha256").update(fileData).digest("hex");
    const id = EntryUtils.newID();
    const blobKey = MediaPaths.blobKey(id, filename);
    const contentType = mimeType && mimeType.trim() ? mimeType : MimeUtils.lookup(filename);

    const release = await this.writeMu.acquire();
    try {
      // Bytes first: a blob with no catalog record is an orphan reconcile can
      // adopt or report, whereas a record with no bytes is a broken asset
      // every reader trips over.
      await this.blobStore.put(blobKey, fileData, { contentType });
      const asset: MediaAsset = {
        filename,
        folder: normalizedFolder,
        blob_key: blobKey,
        size: fileData.length,
        content_type: contentType,
        hash,
        state: "active",
        tags: [],
      };
      const e = await this.putMediaEntry(id, asset);
      return MediaCatalog.toView(e, 0);
    } finally {
      release();
    }
  }

  /** Rename, move, or retag. None of it touches the blob or any entry. */
  async updateMediaAsset(
    id: string,
    patch: { filename?: unknown; folder?: unknown; tags?: unknown }
  ): Promise<MediaAssetView> {
    const release = await this.writeMu.acquire();
    try {
      const e = await this.mediaEntry(id);
      const asset = MediaCatalog.toAsset(e);
      if (asset.state === "deleting") {
        throw new ConflictError(`media asset "${id}" is being deleted`);
      }

      const next: MediaAsset = { ...asset };
      if (patch.filename !== undefined) {
        next.filename = MediaPaths.normalizeFilename(patch.filename, asset.filename);
      }
      if (patch.folder !== undefined) {
        next.folder = MediaPaths.normalizeFolder(patch.folder);
      }
      if (patch.tags !== undefined) {
        if (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== "string")) {
          throw new ValidationError("tags must be an array of strings");
        }
        next.tags = [...new Set(patch.tags as string[])].map((t) => t.trim()).filter(Boolean).sort();
      }

      const updated = await this.putMediaEntry(id, next);
      const [view] = await this.withUsageCounts([updated]);
      return view;
    } finally {
      release();
    }
  }

  /**
   * The deletion saga (§8.1). The catalog and a remote object store cannot
   * share a transaction, so deletion is staged: refuse while referenced, then
   * commit to `deleting`, then delete the blob, then drop the record. A crash
   * after the commit leaves the asset in `deleting`, which
   * `resumePendingMediaDeletions` finishes at startup and which
   * `assertMediaReferencable` refuses to let anything reference again.
   *
   * There is no force-delete.
   */
  async deleteMedia(id: string): Promise<void> {
    const release = await this.writeMu.acquire();
    try {
      const e = await this.mediaEntry(id);
      const asset = MediaCatalog.toAsset(e);

      if (asset.state !== "deleting") {
        const tokens = MediaCatalog.tokens(e.id, asset.blob_key);
        const usage = await this.store.listMediaUsages(tokens, { limit: 0 });
        if (usage.total > 0) {
          throw new MediaInUseError(id, usage.total);
        }
        await this.putMediaEntry(id, { ...asset, state: "deleting" });
      }

      try {
        await this.finishMediaDeletion(id, asset.blob_key);
      } catch (err) {
        // The asset is staged and stays staged — recoverable, but only if the
        // caller learns how. A bare 500 would say nothing about `reconcile`.
        throw new MediaDeleteStalledError(id, asset.blob_key, err);
      }
    } finally {
      release();
    }
  }

  /** Steps 3 and 4 of the saga; idempotent, so a retry is always safe. */
  private async finishMediaDeletion(id: string, blobKey: string): Promise<void> {
    if (blobKey) {
      await this.blobStore.delete(blobKey);
    }
    try {
      await this.store.delete(this.mediaScope(), MediaCatalog.Collection, id);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  /**
   * Carries any asset left mid-delete to completion. Called at startup, where
   * it closes the window a crash between the blob delete and the record
   * delete would otherwise leave open indefinitely.
   *
   * Failures are counted, never thrown: a misconfigured or unreachable blob
   * store would otherwise stop the server booting because of a media deletion
   * somebody staged days ago. Startup **retries**; it does not abort a staged
   * deletion, because a retry is the intended operation and one failure is not
   * evidence the operation is impossible. Reversing it is
   * `reconcileMedia`'s job — the operator-invoked repair.
   */
  async resumePendingMediaDeletions(): Promise<{ finished: number; pending: number }> {
    const res = await this.store.list(this.mediaScope(), MediaCatalog.Collection, {
      filter: { op: "eq", path: "$.data.state", value: "deleting" },
      limit: 500,
      offset: 0,
    });
    let finished = 0;
    let pending = 0;
    for (const e of res.items) {
      try {
        await this.finishMediaDeletion(e.id, MediaCatalog.toAsset(e).blob_key);
        finished++;
      } catch {
        pending++;
      }
    }
    return { finished, pending };
  }

  /**
   * Refuses a *new* reference to an asset that is being deleted, or to one
   * that does not exist at all. Called from the entry write path only —
   * import does not run it, because §7.2 is fidelity-first and an archive
   * must never be rejected for naming an asset it also carries.
   */
  private async assertMediaReferencable(tokens: string[]): Promise<void> {
    for (const token of tokens) {
      if (token.startsWith(MediaRef.BlobTokenPrefix)) continue; // pre-D23 form
      let e: Entry;
      try {
        e = await this.store.get(this.mediaScope(), MediaCatalog.Collection, token);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw new ValidationError(`media asset "${token}" does not exist`);
        }
        throw err;
      }
      if (MediaCatalog.toAsset(e).state === "deleting") {
        throw new ConflictError(`media asset "${token}" is being deleted and cannot be referenced`);
      }
    }
  }

  // ---- Media folders ----
  // D20's existence rule in both halves: a folder exists when it was created
  // explicitly (a `_media_folders` record) or when some asset names it. The
  // explicit half is what lets a folder be made before anything is filed into
  // it — the gap D20 found with empty projects.

  async listMediaFolders(): Promise<string[]> {
    const paths = new Set<string>();

    const declared = await this.store.list(this.mediaScope(), MediaCatalog.FoldersCollection, {
      limit: 100000,
      offset: 0,
    });
    for (const e of declared.items) {
      const folder = MediaCatalog.folderOf(e);
      if (folder) for (const ancestor of MediaPaths.ancestors(folder)) paths.add(ancestor);
    }

    const assets = await this.store.list(this.mediaScope(), MediaCatalog.Collection, {
      limit: 100000,
      offset: 0,
    });
    for (const e of assets.items) {
      const folder = MediaCatalog.toAsset(e).folder;
      if (folder) for (const ancestor of MediaPaths.ancestors(folder)) paths.add(ancestor);
    }

    return [...paths].sort();
  }

  private async folderEntry(folderPath: string): Promise<Entry | null> {
    const res = await this.store.list(this.mediaScope(), MediaCatalog.FoldersCollection, {
      filter: { op: "eq", path: "$.data.path", value: folderPath },
      limit: 1,
      offset: 0,
    });
    return res.items[0] || null;
  }

  async createMediaFolder(folderPath: unknown): Promise<string> {
    const normalized = MediaPaths.normalizeFolder(folderPath);
    if (!normalized) {
      throw new ValidationError("folder path is required");
    }
    const release = await this.writeMu.acquire();
    try {
      if (await this.folderEntry(normalized)) return normalized;
      const now = EntryUtils.now();
      const e: Entry = {
        id: EntryUtils.newID(),
        project: this.mediaScope().project,
        env: this.mediaScope().env,
        collection: MediaCatalog.FoldersCollection,
        rev: 1,
        seq: 0,
        created_at: now,
        updated_at: now,
        data: { path: normalized } satisfies MediaFolder,
      };
      await this.store.put(e, { usages: [], search: null });
      return normalized;
    } finally {
      release();
    }
  }

  /**
   * Removes the explicit record. Refuses while any asset still names the
   * folder or one beneath it — deleting a folder must never be a way to
   * delete the files in it, which would route around the reference guard.
   */
  async deleteMediaFolder(folderPath: unknown): Promise<void> {
    const normalized = MediaPaths.normalizeFolder(folderPath);
    if (!normalized) {
      throw new ValidationError("folder path is required");
    }
    const release = await this.writeMu.acquire();
    try {
      const assets = await this.store.list(this.mediaScope(), MediaCatalog.Collection, {
        limit: 100000,
        offset: 0,
      });
      const occupied = assets.items.filter((e) =>
        MediaPaths.isWithin(MediaCatalog.toAsset(e).folder, normalized)
      ).length;
      if (occupied > 0) {
        throw new ConflictError(
          `folder "${normalized}" still holds ${occupied} file${occupied === 1 ? "" : "s"}`
        );
      }

      for (const e of (
        await this.store.list(this.mediaScope(), MediaCatalog.FoldersCollection, {
          limit: 100000,
          offset: 0,
        })
      ).items) {
        if (MediaPaths.isWithin(MediaCatalog.folderOf(e), normalized)) {
          await this.store.delete(this.mediaScope(), MediaCatalog.FoldersCollection, e.id);
        }
      }
    } finally {
      release();
    }
  }

  // ---- Serving and reconciliation ----

  /**
   * Bytes for a public request. Resolves a catalog id first; falls back to a
   * raw blob key so pre-D23 `/media/<blobKey>` URLs still serve while an
   * instance is being backfilled.
   */
  async getMedia(
    idOrKey: string
  ): Promise<{ data: Uint8Array; contentType?: string; size: number; filename?: string; hash?: string } | null> {
    if (idOrKey.includes("..") || idOrKey.includes("/") || idOrKey.includes("\\")) {
      throw new ValidationError("invalid media identifier");
    }

    try {
      const e = await this.store.get(this.mediaScope(), MediaCatalog.Collection, idOrKey);
      const asset = MediaCatalog.toAsset(e);
      const blob = await this.blobStore.get(asset.blob_key);
      if (!blob) return null;
      return {
        data: blob.data,
        contentType: asset.content_type || blob.contentType,
        size: blob.size,
        filename: asset.filename,
        hash: asset.hash,
      };
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    const blob = await this.blobStore.get(idOrKey);
    if (!blob) return null;
    return {
      data: blob.data,
      contentType: blob.contentType || MimeUtils.lookup(idOrKey),
      size: blob.size,
      filename: idOrKey,
    };
  }

  /**
   * Reconciles the catalog against the blob store: adopts blobs that predate
   * D23 or that a half-finished upload left behind, finishes staged
   * deletions, prunes records whose bytes are gone, and reports orphans
   * without deleting them.
   */
  async reconcileMedia(): Promise<MediaReconcileResult> {
    const release = await this.writeMu.acquire();
    try {
      const result: MediaReconcileResult = {
        adopted: 0,
        pruned: 0,
        finished: 0,
        aborted: 0,
        pending: 0,
        orphans: [],
      };

      const records = await this.store.list(this.mediaScope(), MediaCatalog.Collection, {
        limit: 100000,
        offset: 0,
      });
      const claimed = new Set<string>();

      for (const e of records.items) {
        const asset = MediaCatalog.toAsset(e);
        if (asset.state === "deleting") {
          // Attempt the deletion rather than judging by whether the blob is
          // still there: a crash between staging and the blob delete leaves
          // the bytes in place too, and that case should *complete*, not
          // reverse. An actual failure is the only thing that distinguishes
          // "interrupted" from "impossible".
          try {
            await this.finishMediaDeletion(e.id, asset.blob_key);
            result.finished++;
          } catch {
            try {
              await this.putMediaEntry(e.id, { ...asset, state: "active" });
              result.aborted++;
              // Its bytes are still claimed, so it must not also be reported
              // as an orphan on the same pass.
              claimed.add(asset.blob_key);
            } catch {
              result.pending++;
              claimed.add(asset.blob_key);
            }
          }
          continue;
        }
        if (asset.blob_key && !(await this.blobStore.exists(asset.blob_key))) {
          await this.store.delete(this.mediaScope(), MediaCatalog.Collection, e.id);
          result.pruned++;
          continue;
        }
        claimed.add(asset.blob_key);
      }

      for (const blob of await this.blobStore.list()) {
        if (claimed.has(blob.key)) continue;
        // A pre-D23 key is `<sha256>_<name>`; anything else is reported
        // rather than adopted, because inventing a record for bytes of
        // unknown provenance is a guess, not a repair.
        const split = blob.key.indexOf("_");
        if (split <= 0) {
          result.orphans.push(blob.key);
          continue;
        }
        const hash = blob.key.slice(0, split);
        const filename = MediaPaths.normalizeFilename(blob.key.slice(split + 1));
        const id = EntryUtils.newID();
        await this.putMediaEntry(
          id,
          {
            filename,
            folder: "",
            // Adopts the existing key rather than renaming the object:
            // pre-D23 entries hold `/media/<key>`, and those references are
            // counted through the `blob:` token, which only resolves while
            // the bytes stay where they are.
            blob_key: blob.key,
            size: blob.size,
            content_type: blob.contentType || MimeUtils.lookup(filename),
            hash,
            state: "active",
            tags: [],
          },
          blob.lastModified
        );
        result.adopted++;
      }

      result.orphans.sort();
      return result;
    } finally {
      release();
    }
  }
}
