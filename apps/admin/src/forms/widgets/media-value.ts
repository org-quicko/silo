import { MediaRef } from '@silo/shared/media-ref'
import type { MediaAsset } from '../../api/types/media-asset'

/**
 * Reading a media field's stored value.
 *
 * A stored value is `silo://media/<id>` (D23) — the id addresses the asset, so
 * the preview URL is derived rather than stored and stays correct after a
 * rename or a move. Pre-D23 values (`/media/<key>`) and foreign absolute URLs
 * still render.
 */
export class MediaValue {
  private static readonly ImageExtensions = /\.(png|jpe?g|gif|svg|webp|ico|avif)$/i

  /** The id this field points at, whichever recognised form the value is in. */
  static idOf(value: string | undefined): string | null {
    return value ? MediaRef.canonicalId(value) : null
  }

  static previewUrl(value: string | undefined, baseUrl: string): string {
    if (!value) return ''

    const id = MediaValue.idOf(value)
    if (id) return `${baseUrl}/media/${id}`
    return value.startsWith('/') ? `${baseUrl}${value}` : value
  }

  static looksLikeImage(value: string | undefined): boolean {
    if (!value) return false
    return Boolean(
      MediaValue.idOf(value) ||
        MediaValue.ImageExtensions.test(value) ||
        value.includes('/media/') ||
        value.startsWith('http://') ||
        value.startsWith('https://'),
    )
  }

  /** What to call the file. The resolved asset knows; otherwise fall back to
   *  the reference, then to the last path segment with its hash stripped. */
  static displayName(value: string, asset: MediaAsset | null): string {
    if (asset) return asset.filename
    if (MediaRef.is(value)) return MediaRef.idOf(value)

    const last = value.split('/').pop() || value
    return last.replace(/^[0-9a-f]{16,}_/i, '')
  }
}
