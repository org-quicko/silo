import { createHash } from 'crypto'
import type { SiloContext } from 'silo:api'
import { MultipartBody } from './multipart-body'
import type { StrapiMediaFile } from '../strapi/strapi-media'
import { StrapiMedia } from '../strapi/strapi-media'
import type { StrapiMediaSlot } from '../strapi/strapi-media-slot'
import { StrapiMediaSlots } from '../strapi/strapi-media-slot'
import type { UploadStore } from '../staging/upload-store'

/** What became of the media of one import. */
export interface MediaOutcome {
  /** Files whose bytes went into silo's media library. */
  uploaded: number
  /** Files an earlier import had already put there, byte for byte. */
  matched: number
  /** Fields filled from a file this run had already resolved — the common case
   *  once one flag is on 251 rows. */
  reused: number
  /** Fields left pointing at Strapi, because the file was not supplied. */
  kept: number
  /** Fields left `null`, because there was neither a file nor a URL. */
  empty: number
  /** Bytes handed to silo. */
  bytes: number
  /** Why uploading stopped, when it did. Set once and reported, rather than
   *  repeated per file. */
  stopped: string | null
  /** The first few upload failures, verbatim. */
  notes: string[]
}

/**
 * Turns Strapi's file catalog into silo media references.
 *
 * This is where the two halves meet: the `.db` says which file each row points
 * at, `UploadStore` holds the bytes of the ones the operator supplied, and
 * `POST /api/media` is what makes silo hold them. What comes back is
 * `silo://media/<id>` — a real reference, so the media picker renders it,
 * `MediaRefs.extract` counts it as a usage that blocks the asset's deletion, and
 * a read rewrites it into a URL against whatever host answered.
 *
 * **A file with no bytes still gets a value, and that is the design rather than a
 * fallback nobody thought about.** Silo resolves a foreign URL by leaving it
 * alone, so a field can hold `https://cms.example.com/uploads/x.svg` and still be
 * a media field. That makes supplying the uploads directory *optional per file*:
 * an operator can import today against a Strapi that is still serving, send the
 * files later, and re-import — with no schema change in between, because the
 * schema says `string` either way.
 *
 * **The cache is the point, not an optimisation.** 251 country rows carry 251
 * flags but the same file is one asset; without a cache keyed by filename this
 * would upload each attachment separately and leave silo's library holding
 * duplicate blobs that no reconcile could tell apart.
 *
 * `media:create` is **optional** in the manifest, so this runs unauthorised as a
 * matter of course. A 403 is read as an answer — stop trying, say so once, keep
 * the URLs — because the alternative is one refused request per file and an
 * import that reports nothing an operator could act on.
 */
export class MediaLibrary {
  /** Bounded, because one systemic failure fails every file identically and the
   *  fourth copy of the same message is not information. */
  private static readonly MaxNotes = 3

  private readonly ctx: SiloContext
  private readonly uploads: UploadStore
  private readonly folder: string
  private readonly baseUrl: string

  /** Filename → the value written for it, `null` for a file with no bytes. */
  private readonly refs = new Map<string, string | null>()
  /** Cleared by a 403 from the catalog listing, so an ungranted `media:read`
   *  costs one refused request rather than one per file. */
  private lookups = true
  /** Whether the configured folder has been declared this run. One request, not
   *  one per file — see `declareFolder`. */
  private folderDeclared = false
  private readonly outcome: MediaOutcome = {
    uploaded: 0,
    matched: 0,
    reused: 0,
    kept: 0,
    empty: 0,
    bytes: 0,
    stopped: null,
    notes: [],
  }

  constructor(options: {
    ctx: SiloContext
    uploads: UploadStore
    /** Where in silo's media library the imports land, created once per run
     *  before the first file goes in — see `declareFolder`. Empty is the root. */
    folder: string
    /** The Strapi instance still serving the uploads, for files not supplied. */
    baseUrl: string
  }) {
    this.ctx = options.ctx
    this.uploads = options.uploads
    this.folder = options.folder
    this.baseUrl = options.baseUrl
  }

  /**
   * Fill one entry's media fields, wherever in it they are.
   *
   * Done here rather than in `StrapiRows` because it is the only asynchronous
   * step in shaping a row, and pushing it into the reader would make a database
   * read hold a handle open across an HTTP call for every file it found. A slot
   * carries the path rather than a field name because most of a real export's
   * media is on a *nested* component — `validation.issue`'s two icons live two
   * levels down, inside an array inside an array.
   */
  async attach(entry: Record<string, unknown>, slots: readonly StrapiMediaSlot[]): Promise<void> {
    for (const slot of slots) {
      if (slot.multiple) {
        const values: string[] = []
        for (const file of slot.files) {
          const ref = await this.ref(file)
          if (ref !== null) values.push(ref)
        }
        StrapiMediaSlots.assign(entry, slot.path, values)
        continue
      }
      // A field with no file is `null`, not absent: an absent key and a cleared
      // one read the same to every consumer, and only one of them is what the
      // source says.
      const value = slot.files.length === 0 ? null : await this.ref(slot.files[0]!)
      StrapiMediaSlots.assign(entry, slot.path, value)
    }
  }

  result(): MediaOutcome {
    return { ...this.outcome, notes: [...this.outcome.notes] }
  }

  /** The value one file becomes, uploading its bytes the first time it is seen. */
  private async ref(file: StrapiMediaFile): Promise<string | null> {
    const cached = this.refs.get(file.name)
    if (cached !== undefined) {
      if (cached !== null) {
        this.outcome.reused++
        return cached
      }
      this.link(file)
      return this.url(file)
    }

    if (!this.outcome.stopped) {
      const bytes = await this.uploads.read(file.name)
      if (bytes) {
        const already = await this.existing(file, bytes)
        if (already) {
          this.refs.set(file.name, already)
          this.outcome.matched++
          return already
        }
        const ref = await this.upload(file, bytes)
        if (ref) {
          this.refs.set(file.name, ref)
          this.outcome.uploaded++
          this.outcome.bytes += bytes.byteLength
          return ref
        }
      }
    }

    // No bytes, or none that silo would take. Either way this file is a link from
    // now on, and the cache records that so the next row does not retry the read.
    this.refs.set(file.name, null)
    this.link(file)
    return this.url(file)
  }

  private link(file: StrapiMediaFile): void {
    if (this.url(file) === null) this.outcome.empty++
    else this.outcome.kept++
  }

  private url(file: StrapiMediaFile): string | null {
    const url = StrapiMedia.absolute(file.url, this.baseUrl)
    return url.length === 0 ? null : url
  }

  /**
   * The asset silo already holds for these exact bytes, or `null`.
   *
   * **What makes a re-import idempotent.** Without it, running the same import
   * twice — which `replace` exists to let an operator do — uploads every file a
   * second time: silo's `POST /api/media` mints a new id per request and never
   * deduplicates, so the library doubles and the previous copies become orphans
   * only `silo media reconcile` would ever mention. Measured that way on a live
   * re-run before this existed.
   *
   * Matched on silo's **sha256**, not on the filename. The filename is what makes
   * the candidate list small enough to ask for, but Strapi's content hash in a
   * name is a convention and a digest is a fact — and the digest is already in the
   * catalog record, so this costs one listing per distinct file and no bytes.
   *
   * Needs `media:read`, which is optional. Ungranted, this answers `null` once and
   * then stops asking, and the import degrades to what it did before: correct, and
   * duplicating on a re-run.
   */
  private async existing(file: StrapiMediaFile, bytes: Uint8Array): Promise<string | null> {
    if (!this.lookups) return null

    const query =
      `/api/media?limit=50&q=${encodeURIComponent(file.name)}` +
      (this.folder ? `&folder=${encodeURIComponent(this.folder)}` : '')

    let response
    try {
      response = await this.ctx.fetch(query)
    } catch {
      // A failed lookup is not a failed import: the file uploads instead.
      return null
    }
    if (response.status === 403) {
      this.lookups = false
      return null
    }
    if (!response.ok) return null

    const digest = createHash('sha256').update(bytes).digest('hex')
    const items = response.json()?.items ?? []
    for (const asset of items) {
      if (asset?.hash === digest && typeof asset.id === 'string') return `silo://media/${asset.id}`
    }
    return null
  }

  /**
   * Make the configured folder exist before the first file goes into it.
   *
   * An asset naming a folder already implies one (D20's existence rule), so this
   * is not what puts the uploads in the right place — `folder` on the upload
   * itself does that. What it adds is the **explicit** half: the folder shows up
   * in the library's tree straight away, it survives every file in it being
   * deleted, and an operator who configured `media_folder` sees the folder they
   * named rather than one that appears only once something lands.
   *
   * Once per run, and never fatal. `POST /api/media/folders` takes the same
   * `media:create` the upload does, so a refusal here is the refusal `upload`
   * reports in full a moment later, and a plugin that stopped importing over a
   * folder record would be refusing to do the job over the label on the drawer.
   */
  private async declareFolder(): Promise<void> {
    if (this.folderDeclared || this.folder.length === 0) return
    this.folderDeclared = true
    try {
      await this.ctx.fetch('/api/media/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: this.folder }),
      })
    } catch {
      // The upload below carries the folder too, so the files still land in it.
    }
  }

  /** One upload, or `null` with the reason recorded. */
  private async upload(file: StrapiMediaFile, bytes: Uint8Array): Promise<string | null> {
    await this.declareFolder()

    const parts = [
      {
        name: 'file',
        filename: file.name,
        // Strapi's own MIME type, which is authoritative for a file it stored.
        // Silo derives one from the filename when this is blank, so the fallback
        // is only reached for a catalog row that never recorded one.
        contentType: file.mime && file.mime.trim() ? file.mime : 'application/octet-stream',
        value: bytes,
      },
      ...(this.folder ? [{ name: 'folder', value: this.folder }] : []),
    ]
    const built = MultipartBody.build(parts)

    let response
    try {
      response = await this.ctx.fetch('/api/media', {
        method: 'POST',
        headers: { 'content-type': built.contentType },
        body: built.bytes,
      })
    } catch (caught: any) {
      this.note(file, caught?.message ?? String(caught))
      return null
    }

    if (response.status === 403) {
      this.outcome.stopped =
        'this plugin has not been granted "media:create", so the uploads were not added to ' +
        "silo's media library. Every media field kept its Strapi URL. Grant it on this " +
        "plugin's page and re-import to bring the files across."
      return null
    }
    if (!response.ok) {
      this.note(file, response.json()?.error?.message ?? `silo answered ${response.status}`)
      return null
    }

    const id = response.json()?.id
    if (typeof id !== 'string' || id.length === 0) {
      this.note(file, 'silo accepted the upload without returning an id')
      return null
    }
    return `silo://media/${id}`
  }

  private note(file: StrapiMediaFile, message: string): void {
    if (this.outcome.notes.length < MediaLibrary.MaxNotes) {
      this.outcome.notes.push(`${file.name}: ${message}`)
    }
  }
}
