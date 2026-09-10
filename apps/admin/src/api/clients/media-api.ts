import type { MediaAsset as SiloMediaAsset, MediaAssetRecord } from 'silo-client'
import type { MediaAsset } from '../types/media-asset'
import type { MediaBulkDeleteResult } from '../types/media-bulk-delete'
import type { MediaFolderDeleteResult } from '../types/media-folder-delete'
import type { MediaQuery } from '../types/media-query'
import type { MediaPolicyInput, MediaPolicyView } from '../types/media-settings'
import type { MediaStorageInput, MediaStorageView } from '../types/media-storage'
import type { MediaUsage } from '../types/media-usage'
import type { HttpTransport } from '../transport/http-transport'

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
    const silo = this.transport.silo(url, key)
    return silo.media
      .list({
        text: query.q,
        folder: query.folder,
        recursive: query.recursive,
        type: query.type,
        extension: query.ext,
        tag: query.tag,
        modifiedAfter: query.modifiedAfter,
        modifiedBefore: query.modifiedBefore,
        limit: query.limit,
        offset: query.offset,
        sort: query.sort,
      })
      .then((page) => ({
        items: page.files.map((asset) => MediaApi.toMediaAsset(asset)),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      }))
  }

  upload(url: string, key: string, file: File, folder?: string): Promise<MediaAsset> {
    return this.transport
      .silo(url, key)
      .media.upload(file, { folder })
      .then((asset) => MediaApi.toMediaAsset(asset))
  }

  get(url: string, key: string, id: string): Promise<MediaAsset> {
    return this.transport
      .silo(url, key)
      .media.get(id)
      .then((asset) => MediaApi.toMediaAsset(asset))
  }

  /** Rename, move, or retag. Touches no blob and no entry. */
  async update(
    url: string,
    key: string,
    id: string,
    patch: { filename?: string; folder?: string; tags?: string[] },
  ): Promise<MediaAsset> {
    let asset = await this.transport.silo(url, key).media.get(id)
    if (patch.filename && patch.filename !== asset.filename) {
      asset = await asset.rename(patch.filename)
    }
    if (patch.folder !== undefined && patch.folder !== asset.folder) {
      asset = await asset.moveTo(patch.folder)
    }
    if (patch.tags !== undefined) {
      asset = await asset.setTags(patch.tags)
    }
    return MediaApi.toMediaAsset(asset)
  }

  /** Rejects with a 409 `media_in_use` while any entry still references it,
   *  unless `force` is set (D48), which deletes over a live reference. */
  async delete(url: string, key: string, id: string, force = false): Promise<void> {
    const asset = await this.transport.silo(url, key).media.get(id)
    return asset.delete({ force })
  }

  /** One request, one id per outcome, always `200` (D48). A single-file
   *  delete and a multi-select delete are both this, with one id. */
  deleteMany(url: string, key: string, ids: string[], force = false): Promise<MediaBulkDeleteResult> {
    return this.transport
      .silo(url, key)
      .media.deleteMany(ids, { force })
      .then((report) => ({
        deleted: [...report.deleted],
        failed: report.failed.map((f) => ({
          id: f.id,
          code: f.code as 'media_in_use' | 'not_found' | 'media_delete_stalled' | 'invalid_id',
          message: f.message,
          usage_count: f.usageCount,
          visible_count: f.visibleCount,
          visible_capped: f.visibleCapped,
          referrers: f.referrers?.map((r) => ({
            media_id: r.mediaId,
            project: r.project,
            env: r.environment,
            collection: r.collection,
            entry_id: r.entryId,
          })),
        })),
      }))
  }

  async usages(
    url: string,
    key: string,
    id: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: MediaUsage[]; total: number; visible: number; visible_capped: boolean }> {
    const asset = await this.transport.silo(url, key).media.get(id)
    const page = await asset.usages({ limit, offset })
    return {
      items: page.usages.map((r) => ({
        media_id: r.mediaId,
        project: r.project,
        env: r.environment,
        collection: r.collection,
        entry_id: r.entryId,
      })),
      total: page.total,
      visible: page.visible,
      visible_capped: page.visibleCapped,
    }
  }

  listFolders(url: string, key: string): Promise<string[]> {
    return this.transport.silo(url, key).media.folders.list()
  }

  /** Every distinct file extension in the library — the Type filter's menu
   *  (D55), built from what is actually there rather than a fixed list. */
  listExtensions(url: string, key: string): Promise<string[]> {
    return this.transport.silo(url, key).media.extensions()
  }

  async createFolder(url: string, key: string, path: string): Promise<{ path: string }> {
    const createdPath = await this.transport.silo(url, key).media.folders.create(path)
    return { path: createdPath }
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
    return this.transport.silo(url, key).media.folders.rename(from, to, { merge })
  }

  /** Empty-folder delete: refuses while anything is inside. */
  deleteFolder(url: string, key: string, path: string): Promise<void> {
    return this.transport.silo(url, key).media.folders.delete(path)
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

  static toMediaAsset(asset: SiloMediaAsset | MediaAssetRecord): MediaAsset {
    const rec = typeof (asset as any).toJSON === 'function' ? (asset as SiloMediaAsset).toJSON() : (asset as MediaAssetRecord)
    return {
      id: rec.id,
      filename: rec.filename,
      folder: rec.folder,
      blob_key: rec.blobKey,
      size: rec.sizeInBytes,
      content_type: rec.contentType,
      hash: rec.hash,
      state: rec.state,
      tags: [...rec.tags],
      url: rec.url,
      created_at: rec.createdAt instanceof Date ? rec.createdAt.toISOString() : String(rec.createdAt),
      updated_at: rec.updatedAt instanceof Date ? rec.updatedAt.toISOString() : String(rec.updatedAt),
      usage_count: rec.usageCount,
    }
  }

  private static readonly StoragePath = '/api/media/storage'
  private static readonly SettingsPath = '/api/media/settings'
}
