import type { MediaAsset } from '../../api/types/media-asset'

/**
 * The URL to fetch an asset's bytes from (D46, D60).
 *
 * The one place the admin turns a media reference into something an `<img>` can
 * load. It exists because there are two ways to get that wrong and both fail as
 * a broken image on a page whose whole job is to show the file.
 *
 * **Joining unconditionally.** `asset.url` is relative until `[media] base_url`
 * is configured and absolute afterwards, and absolute again on a public bucket,
 * so `${serverUrl}${asset.url}` produces
 * `http://localhost:8090https://cms.example.com/media/…` the moment either is
 * set. Three call sites did this before D60 and only this one did not.
 *
 * **Building the path by hand.** A caller that assembles `<server>/media/<id>`
 * is repeating a rule that lives on the server, and repeating it is how the
 * admin came to preview a different link from the one the API hands out. Prefer
 * `of`, which uses the URL the server already answered with. `forId` is for the
 * entry form, which holds a stored `silo://media/<id>` and no asset record to
 * read a URL from; for `downloadUrl`, whose flag only silo's own route reads
 * (D100); and for the preview's text `fetch`, which needs the CORS header only
 * silo's own route sends (D101).
 */
export class MediaFileUrl {
  /** The server's own answer for this asset, made absolute if it is not. */
  static of(asset: MediaAsset, serverUrl: string): string {
    return MediaFileUrl.join(asset.url, serverUrl)
  }

  /**
   * An asset addressed by id alone, for a caller holding a stored reference
   * rather than a catalog record.
   *
   * Always silo's own route on the connected server, never a bucket URL: silo
   * serves `/media/<id>` whatever it *advertises*, so this resolves even on an
   * instance handing out S3 links, where this caller has no blob key to build
   * one with anyway.
   */
  static forId(id: string, serverUrl: string): string {
    return `${MediaFileUrl.root(serverUrl)}/media/${encodeURIComponent(id)}`
  }

  /**
   * The URL that saves this asset rather than showing it (D100).
   *
   * Silo's own route, not `asset.url`: a bucket or a `base_url` host would ignore
   * `?download=true`. The `attachment` it asks for is what makes a browser save
   * the file on a link to another origin, where the `download` attribute does
   * nothing.
   */
  static downloadUrl(asset: Pick<MediaAsset, 'id'>, serverUrl: string): string {
    return `${MediaFileUrl.forId(asset.id, serverUrl)}?download=true`
  }

  /** A value that may already be absolute, rooted at the server if it is not. */
  static join(url: string, serverUrl: string): string {
    if (!url) return ''
    if (MediaFileUrl.isAbsolute(url)) return url
    return `${MediaFileUrl.root(serverUrl)}${url.startsWith('/') ? '' : '/'}${url}`
  }

  /**
   * The server URL without a trailing slash, or '' when it is not http(s).
   *
   * It comes from the server form by way of localStorage and ends up in an
   * `href`, so a `javascript:` value must not survive. The scheme is written
   * here as a literal, never copied from the input.
   */
  private static root(serverUrl: string): string {
    let parsed: URL
    try {
      parsed = new URL(serverUrl)
    } catch {
      return ''
    }
    const scheme = parsed.protocol === 'https:' ? 'https://' : parsed.protocol === 'http:' ? 'http://' : null
    if (!scheme) return ''
    return `${scheme}${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
  }

  private static isAbsolute(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://')
  }
}
