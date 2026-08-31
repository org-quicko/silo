import { MediaField } from '@silo/shared/media-field'
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

  /**
   * Strips media fields that read as `null` from data about to be
   * submitted, structurally walking `schema` the way the server's
   * `MediaResolver.resolveMediaFields` walks it to build that `null` in the
   * first place.
   *
   * A force-deleted asset (D48) makes its referring field read `null` on
   * fetch. `null` is not a value the media schema accepts — RJSF's ajv8 and
   * the server's own validator both reject it on the ordinary
   * `{"type": "string", "x-silo-type": "media"}` field — so a form that
   * takes `entry.data` verbatim as `formData` and PUTs it back turns "this
   * file is gone" into a validation error on a field nobody touched.
   * Omitting the key instead of sending `null` lets an optional field save
   * clean and a required one fail with an honest "required" error: the
   * entry really has lost a file it needs. A media *array*'s `null` slots
   * are filtered out rather than the whole field dropped, since the array
   * itself is still a value worth keeping.
   */
  static omitUnresolved(data: unknown, schema: unknown): unknown {
    if (!data || typeof data !== 'object' || !schema || typeof schema !== 'object') return data

    if (Array.isArray(data)) {
      const itemSchema = (schema as any).items
      if (!itemSchema) return data
      return data.map((item) => MediaValue.omitUnresolved(item, itemSchema))
    }

    const properties = (schema as any).properties || {}
    const result: Record<string, any> = { ...(data as Record<string, unknown>) }

    for (const [key, val] of Object.entries(result)) {
      const prop = properties[key]
      if (!prop) continue

      if (MediaValue.isMediaSchema(prop)) {
        if (val === null) delete result[key]
        else if (Array.isArray(val)) result[key] = val.filter((v) => v !== null)
      } else if (prop.type === 'array' && MediaValue.isMediaSchema(prop.items)) {
        if (Array.isArray(val)) result[key] = val.filter((v) => v !== null)
      } else if (prop.type === 'object' && prop.properties) {
        result[key] = MediaValue.omitUnresolved(val, prop)
      } else if (prop.type === 'array' && prop.items?.type === 'object' && prop.items?.properties && Array.isArray(val)) {
        result[key] = val.map((v) => MediaValue.omitUnresolved(v, prop.items))
      }
    }

    return result
  }

  /** The same "is this a media field" heuristic `buildUiSchema` uses to pick
   *  the media widget, so what renders as media and what gets omitted here
   *  cannot disagree. */
  private static isMediaSchema(prop: any): boolean {
    if (!prop || typeof prop !== 'object') return false
    const widget = prop['x-silo-ui']?.widget
    return (
      MediaField.is(prop) ||
      prop['x-silo-media'] === true ||
      (prop.type === 'string' && (prop.format === 'uri' || widget === 'media'))
    )
  }
}
