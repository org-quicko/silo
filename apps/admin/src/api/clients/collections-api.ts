import type { Collection } from '../types/collection'
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

  list(url: string, key: string, scope: ScopeRef): Promise<Collection[]> {
    return this.transport
      .request<{ items: Collection[] }>(url, key, ScopePaths.collections(scope))
      .then((response) => response.items)
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
