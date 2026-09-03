import type { CollectionRecord } from "../domain/collection-record";
import type { Entry } from "../domain/entry";
import type { EnvironmentRecord } from "../domain/environment-record";
import type { Meta } from "../domain/meta";
import type { ProjectRecord } from "../domain/project-record";
import type { Scope } from "../domain/scope";
import type { Query } from "../query/query";
import type { MediaUsage } from "../media/media-usage";
import type { DerivedIndex } from "./derived-index";

/**
 * Where entries, schemas and scopes live.
 *
 * Two adapters implement this — SQLite and the filesystem — and the
 * conformance suite is the contract: both must answer every question the same
 * way. See `docs/design/storage.md` for the rules behind the shape, including
 * record existence (D51, superseding D20), the path-segment contract, and why
 * `derived` is required rather than optional.
 */
export interface Storage {
  // ---- Projects, environments and collections (D51) ----
  //
  // All three are **keyed records**: a ULID that never changes, and a mutable
  // `name` that every route path, claim string and archive directory addresses.
  // A record **exists** when it was created — not, as under D20, when it was
  // created *or* still holds content, because a child now references its parent
  // by id and so cannot outlive it.
  //
  // Every listing addresses by name and every rename by **id**, since the id is
  // the one thing a concurrent rename cannot move under the caller's feet.
  // Renames refuse a collision within their container. `_`-prefixed names are
  // reserved (`Scope.System`, `SystemCollections`) and never appear in these
  // listings.
  //
  // The optional `id` on the create paths exists for **import**, which carries
  // ids in its markers and would otherwise remint every record it restores. An
  // adapter mints one when it is omitted; a supplied id that is malformed or
  // already taken is refused rather than silently replaced.

  createProject(name: string, id?: string): Promise<ProjectRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  findProject(name: string): Promise<ProjectRecord | null>;
  renameProject(id: string, name: string): Promise<void>;
  /** Removes the record *and* everything stored beneath it. */
  deleteProject(name: string): Promise<void>;

  createEnvironment(project: string, env: string, id?: string): Promise<EnvironmentRecord>;
  listEnvironments(project: string): Promise<EnvironmentRecord[]>;
  findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null>;
  renameEnvironment(id: string, name: string): Promise<void>;
  deleteEnvironment(project: string, env: string): Promise<void>;

  listCollections(scope: Scope): Promise<CollectionRecord[]>;
  findCollection(scope: Scope, collection: string): Promise<CollectionRecord | null>;
  renameCollection(id: string, name: string): Promise<void>;

  // ---- Schemas ----
  //
  // There is no `createCollection`: a collection's schema is `NOT NULL`, so
  // `putSchema` is the only thing that brings a record into being, and
  // `deleteSchema` is what ends it — it removes the whole collection record,
  // not a nullable field on a record that survives.

  putSchema(
    scope: Scope,
    collection: string,
    schema: any,
    id?: string
  ): Promise<CollectionRecord>;
  getSchema(scope: Scope, collection: string): Promise<any>;
  deleteSchema(scope: Scope, collection: string): Promise<void>;

  // ---- Entries ----
  //
  // `collection` and `id` — and `project`/`env` on `put`, which reads the
  // scope off the self-describing envelope (D18) — must be safe path segments
  // (`EntryUtils.assertSafeSegment`). Every adapter enforces this identically:
  // an import takes an entry's id from file *contents*, not from the trusted
  // archive path. The envelope still carries **names**, which each adapter
  // resolves to ids on write and restores on read.

  /** `derived` carries the state that must land atomically with the write
   *  (D23, D30): the entry's complete media reference set, and its index text.
   *  Required, not optional — an omitted set has no safe reading. */
  put(entry: Entry, derived: DerivedIndex): Promise<void>;
  get(scope: Scope, collection: string, id: string): Promise<Entry>;
  /** Drops the entry's usages as part of the same operation. */
  delete(scope: Scope, collection: string, id: string): Promise<void>;
  list(
    scope: Scope,
    collection: string,
    query: Query
  ): Promise<{ items: Entry[]; total: number }>;

  /**
   * How many entries each collection in `scope` holds, keyed by collection
   * **name**. A collection with no entries is absent rather than zero, so a
   * reader takes `?? 0`.
   *
   * One question, one answer: the alternative every caller reached for was a
   * `limit: 1` list per collection, which transfers a whole entry to learn a
   * number and costs one round trip per collection — measured at four
   * megabytes to draw a sidebar over forty collections of tabular content.
   */
  countEntries(scope: Scope): Promise<Map<string, number>>;

  /** Every non-system scope that exists, sorted by (project, env). */
  listScopes(): Promise<Scope[]>;

  /**
   * Every collection in `scope` that still holds at least one entry.
   *
   * No longer load-bearing for addressing — since D51 every collection has a
   * record, so `listCollections` is the authority on what exists and this
   * cannot report one that does not. It stays because "which of these hold
   * content" is a question the export engine and the scope-delete guard both
   * ask, and answering it from records alone would mean counting every
   * collection's entries to find out.
   */
  listEntryCollections(scope: Scope): Promise<string[]>;

  // ---- Media usages (D23) ----
  //
  // Derived state the adapter owns and keeps consistent with entries by
  // whatever means suits it — an indexed table, or a scan. Both methods take a
  // list of tokens because the delete guard asks about an asset's catalog id
  // and its pre-D23 `blob:<key>` form at once.

  /** Mirrors `list`'s `{items, total}` so a 409 gets its count and its
   *  enumerable page from one call. Ordering is by scope **name**, resolved
   *  before the page is cut, so a page boundary does not move with the ids. */
  listMediaUsages(
    mediaIds: string[],
    page?: { limit?: number; offset?: number }
  ): Promise<{ items: MediaUsage[]; total: number }>;

  /** Counts for many assets at once, so a library page needs one query. */
  countMediaUsages(mediaIds: string[]): Promise<Map<string, number>>;

  /** Instance id, `last_seq`, and whether the configured defaults have ever
   *  been seeded (D51 — so a renamed or deleted default is not resurrected at
   *  the next start). `seq` is instance-global and monotonic across every
   *  scope. */
  meta(): Promise<Meta>;
  /** Records that the configured defaults were seeded. Idempotent. */
  markDefaultsInitialized(): Promise<void>;

  close(): Promise<void>;
}
