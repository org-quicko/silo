import type { MediaAsset } from '../../api/types/media-asset'

/**
 * The URL to fetch an asset's bytes from (D46).
 *
 * `asset.url` is relative until `[media] base_url` is configured, and absolute
 * afterwards — the server answers with the public URL once it knows one, so
 * that what the admin previews is the same link a consumer of the API gets.
 * Joining unconditionally is what this exists to prevent: it would produce
 * `http://localhost:8090https://cms.example.com/media/…`, which fails as a
 * broken image on a page whose whole job is to show the file.
 */
export class MediaFileUrl {
  static of(asset: MediaAsset, serverUrl: string): string {
    return MediaFileUrl.isAbsolute(asset.url) ? asset.url : `${serverUrl}${asset.url}`
  }

  private static isAbsolute(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://')
  }
}
