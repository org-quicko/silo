import type { MediaAsset } from '../types/media-asset'
import type { MediaBulkDeleteResult } from '../types/media-bulk-delete'
import type { MediaFolderDeleteResult } from '../types/media-folder-delete'
import type { MediaQuery } from '../types/media-query'
import type { MediaPolicyInput, MediaPolicyView } from '../types/media-settings'
import type { MediaStorageInput, MediaStorageView } from '../types/media-storage'
import type { MediaUsage } from '../types/media-usage'
import type { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'

/** One page of the media library. */
export interface MediaPage {
  items: MediaAsset[]
  total: number
  limit: number
  offset: number
}

/**
 * The media library (D23).
 *
 * The catalog is searched server-side through the Query AST, so the library
 * pages rather than loading every asset and filtering in the browser.
 */
export class MediaApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string, query: MediaQuery = {}): Promise<MediaPage> {
    const params = new QueryParams()
      .set('q', query.q)
      // `folder=""` is the library root, not "no folder filter".
      .setEvenIfEmpty('folder', query.folder)
      .set('recursive', query.recursive ? 'true' : undefined)
      .set('type', query.type)
      .set('ext', query.ext)
      .set('tag', query.tag)
      .set('modified_after', query.modifiedAfter)
      .set('modified_before', query.modifiedBefore)
      .set('limit', query.limit)
      .set('offset', query.offset)
      .set('sort', query.sort)

    return this.transport.request<MediaPage>(url, key, `/api/media${params}`)
  }

  upload(url: string, key: string, file: File, folder?: string): Promise<MediaAsset> {
    const form = new FormData()
    form.append('file', file)
    if (folder) form.append('folder', folder)
    return this.transport.request<MediaAsset>(url, key, '/api/media', {
      method: 'POST',
      body: form,
    })
  }

  get(url: string, key: string, id: string): Promise<MediaAsset> {
    return this.transport.request<MediaAsset>(url, key, MediaApi.assetPath(id))
  }

  /** Rename, move, or retag. Touches no blob and no entry. */
  update(
    url: string,
    key: string,
    id: string,
    patch: { filename?: string; folder?: string; tags?: string[] },
  ): Promise<MediaAsset> {
    return this.transport.request<MediaAsset>(url, key, MediaApi.assetPath(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  /** Rejects with a 409 `media_in_use` while any entry still references it,
   *  unless `force` is set (D48), which deletes over a live reference. */
  delete(url: string, key: string, id: string, force = false): Promise<void> {
    const path = force ? `${MediaApi.assetPath(id)}?force=true` : MediaApi.assetPath(id)
    return this.transport.request<void>(url, key, path, { method: 'DELETE' })
  }

  /** One request, one id per outcome, always `200` (D48). A single-file
   *  delete and a multi-select delete are both this, with one id. */
  deleteMany(url: string, key: string, ids: string[], force = false): Promise<MediaBulkDeleteResult> {
    return this.transport.request<MediaBulkDeleteResult>(url, key, '/api/media/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, force }),
    })
  }

  usages(
    url: string,
    key: string,
    id: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: MediaUsage[]; total: number; visible: number; visible_capped: boolean }> {
    return this.transport.request(
      url,
      key,
      `${MediaApi.assetPath(id)}/usages?limit=${limit}&offset=${offset}`,
    )
  }

  listFolders(url: string, key: string): Promise<string[]> {
    return this.transport
      .request<{ items: string[] }>(url, key, '/api/media/folders')
      .then((response) => response.items)
  }

  /** Every distinct file extension in the library — the Type filter's menu
   *  (D51), built from what is actually there rather than a fixed list. */
  listExtensions(url: string, key: string): Promise<string[]> {
    return this.transport
      .request<{ items: string[] }>(url, key, '/api/media/extensions')
      .then((response) => response.items)
  }

  createFolder(url: string, key: string, path: string): Promise<{ path: string }> {
    return this.transport.request<{ path: string }>(url, key, '/api/media/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  }

  /** Rename or move a folder, its descendant folders, and every asset within.
   *  Touches no entry and moves no blob (D49). `merge` joins an existing `to`
   *  instead of refusing on collision — off by default, since a collision
   *  should refuse until the caller opts in. */
  renameFolder(
    url: string,
    key: string,
    from: string,
    to: string,
    merge = false,
  ): Promise<{ from: string; to: string }> {
    return this.transport.request<{ from: string; to: string }>(url, key, '/api/media/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, merge }),
    })
  }

  /** Empty-folder delete: refuses while anything is inside. */
  deleteFolder(url: string, key: string, path: string): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `/api/media/folders?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    )
  }

  /** Recursive folder delete (D49): every asset inside goes through the same
   *  per-id outcome machinery `deleteMany` does, then the folder records — an
   *  asset that comes back `media_in_use` means the folder is not gone. */
  deleteFolderRecursive(url: string, key: string, path: string, force = false): Promise<MediaFolderDeleteResult> {
    const query = `path=${encodeURIComponent(path)}&recursive=true${force ? '&force=true' : ''}`
    return this.transport.request<MediaFolderDeleteResult>(url, key, `/api/media/folders?${query}`, {
      method: 'DELETE',
    })
  }

  /** Empties the whole library: every asset, then every folder record
   *  (D49). The literal confirmation word is the cheapest insurance against a
   *  stray or replayed request. */
  purge(url: string, key: string, force = false): Promise<MediaFolderDeleteResult> {
    return this.transport.request<MediaFolderDeleteResult>(url, key, '/api/media/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'purge', force }),
    })
  }

  /** Where the library keeps its bytes, and what the file versus the process
   *  says about it (D45). Behind `media:configure`, unlike everything above. */
  storage(url: string, key: string): Promise<MediaStorageView> {
    return this.transport.request<MediaStorageView>(url, key, MediaApi.StoragePath)
  }

  /** Save it. Repoints the running server as well as the file, and answers with
   *  the view a fresh read would give. */
  saveStorage(url: string, key: string, input: MediaStorageInput): Promise<MediaStorageView> {
    return this.transport.request<MediaStorageView>(url, key, MediaApi.StoragePath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  }

  /** Where media URLs point and what the library accepts (D46). The other
   *  half of the settings page, behind the same `media:configure` claim. */
  settings(url: string, key: string): Promise<MediaPolicyView> {
    return this.transport.request<MediaPolicyView>(url, key, MediaApi.SettingsPath)
  }

  /** Save it. Applies to the running server as well as the file. */
  saveSettings(url: string, key: string, input: MediaPolicyInput): Promise<MediaPolicyView> {
    return this.transport.request<MediaPolicyView>(url, key, MediaApi.SettingsPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  }

  private static readonly StoragePath = '/api/media/storage'
  private static readonly SettingsPath = '/api/media/settings'

  private static assetPath(id: string): string {
    return `/api/media/${encodeURIComponent(id)}`
  }
}
