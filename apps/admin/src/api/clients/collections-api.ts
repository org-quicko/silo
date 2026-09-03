import type { Collection } from '../types/collection'
import type { CollectionSummary } from '../types/collection-summary'
import type { RenameResult } from '../types/scope-record'
import type { ScopeRef } from '../types/scope-ref'
import type { HttpTransport } from '../transport/http-transport'
import { ScopePaths } from './scope-paths'

/** Collections and their JSON Schemas. */
export class CollectionsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** Name, entry count, access and timestamps — no schemas (D54). What the
   *  sidebar and every navigation surface reads. */
  list(url: string, key: string, scope: ScopeRef): Promise<CollectionSummary[]> {
    return this.transport
      .request<{ items: CollectionSummary[] }>(url, key, ScopePaths.collections(scope))
      .then((response) => response.items)
  }

  /**
   * Every schema in the scope, for the two screens that need the whole graph
   * at once: the entry form resolves `silo://` refs across collections, and the
   * schema editor offers every collection as a ref target.
   *
   * A sibling of `collections` rather than a path beneath it, because `schemas`
   * is a legal collection name.
   */
  schemas(url: string, key: string, scope: ScopeRef): Promise<Collection[]> {
    return this.transport
      .request<{ items: Collection[] }>(url, key, `${ScopePaths.scope(scope)}/schemas`)
      .then((response) => response.items)
  }

  /** One collection with its schema — what a page rendering that collection
   *  needs, and all it needs. */
  get(url: string, key: string, scope: ScopeRef, name: string): Promise<Collection> {
    return this.transport.request<Collection>(
      url,
      key,
      ScopePaths.collections(scope, `/${encodeURIComponent(name)}/schema`),
    )
  }

  create(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    schema: any,
  ): Promise<Collection> {
    return this.transport.request<Collection>(url, key, ScopePaths.collections(scope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, schema }),
    })
  }

  putSchema(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    schema: any,
  ): Promise<Collection> {
    return this.transport.request<Collection>(
      url,
      key,
      ScopePaths.collections(scope, `/${encodeURIComponent(name)}/schema`),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schema),
      },
    )
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
    const query = new URLSearchParams({ expected_id: expectedId })
    if (dryRun) query.set('dry_run', 'true')

    return this.transport.request<RenameResult>(
      url,
      key,
      ScopePaths.collections(scope, `/${encodeURIComponent(name)}?${query.toString()}`),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: to }),
      },
    )
  }

  delete(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    force = false,
  ): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      ScopePaths.collections(scope, `/${encodeURIComponent(name)}/schema?force=${force}`),
      { method: 'DELETE' },
    )
  }
}
