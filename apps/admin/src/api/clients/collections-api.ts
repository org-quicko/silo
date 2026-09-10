import type { Collection } from '../types/collection'
import type { CollectionSummary } from '../types/collection-summary'
import type { RenameResult } from '../types/scope-record'
import type { ScopeRef } from '../types/scope-ref'
import type { HttpTransport } from '../transport/http-transport'

/** Collections and their JSON Schemas. */
export class CollectionsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** Name, entry count, access and timestamps — no schemas (D54). What the
   *  sidebar and every navigation surface reads. */
  list(url: string, key: string, scope: ScopeRef): Promise<CollectionSummary[]> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).collections.list()
  }

  /**
   * Every schema in the scope, for the two screens that need the whole graph
   * at once: the entry form resolves `silo://` refs across collections, and the
   * schema editor offers every collection as a ref target.
   */
  schemas(url: string, key: string, scope: ScopeRef): Promise<Collection[]> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).schemas()
  }

  /** One collection with its schema — what a page rendering that collection
   *  needs, and all it needs. */
  get(url: string, key: string, scope: ScopeRef, name: string): Promise<Collection> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).collection(name).schema.get()
  }

  create(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    schema: any,
  ): Promise<Collection> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).collections.create(name, schema)
  }

  putSchema(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    schema: any,
  ): Promise<Collection> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).collection(name).schema.put(schema)
  }

  /**
   * Renames a collection, and repoints every `$ref` to it (D51).
   *
   * Needs `collections:schema:update` on each referring collection as well,
   * which the server checks up front — so a 403 here can be about a schema the
   * operator was not editing.
   */
  rename(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    to: string,
    expectedId: string,
    dryRun = false,
  ): Promise<RenameResult> {
    return this.transport
      .silo(url, key)
      .scope(scope.project, scope.env)
      .collection(name)
      .rename(to, { expectedId, dryRun })
  }

  delete(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    force = false,
  ): Promise<void> {
    return this.transport
      .silo(url, key)
      .scope(scope.project, scope.env)
      .collection(name)
      .schema.delete({ force })
  }
}
