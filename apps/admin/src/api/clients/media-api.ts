import type { MediaAsset } from '../types/media-asset'
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
      .set('tag', query.tag)
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

  /** Rejects with a 409 `media_in_use` while any entry still references it. */
  delete(url: string, key: string, id: string): Promise<void> {
    return this.transport.request<void>(url, key, MediaApi.assetPath(id), { method: 'DELETE' })
  }

  usages(
    url: string,
    key: string,
    id: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: MediaUsage[]; total: number; visible: number }> {
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

  createFolder(url: string, key: string, path: string): Promise<{ path: string }> {
    return this.transport.request<{ path: string }>(url, key, '/api/media/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  }

  deleteFolder(url: string, key: string, path: string): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `/api/media/folders?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    )
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
