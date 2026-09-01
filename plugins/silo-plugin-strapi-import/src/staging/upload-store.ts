import fs from 'fs/promises'
import path from 'path'

/** One staged upload, as the panel lists it. */
export interface StagedUpload {
  name: string
  bytes: number
}

/**
 * Where Strapi's `public/uploads` files live while an import runs.
 *
 * **Why the bytes have to be staged at all.** A `strapi transfer` database is the
 * file *catalog* — names, MIME types, `/uploads/…` paths — and never the uploads
 * themselves, so a media field could only ever import as a URL pointing back at
 * the instance being migrated off. Silo's media type wants a reference to a file
 * silo holds, and there is exactly one way to get one: hand silo the bytes.
 *
 * **Why one file per request, rather than an archive.** The alternative was a zip
 * of the uploads directory through the same `bytes` route the `.db` uses, and it
 * fails on the number that decides it: `PluginRouteBodies.Ceiling` is 64 MiB, and
 * that is a cap on **one request**. A real instance's uploads directory is
 * routinely larger than that, so an archive route could not carry the case it
 * exists for, while a per-file route caps at 64 MiB *per file* — which is the
 * right unit, because it is the unit silo's media library stores. It also needs no
 * archive reader in a plugin, and it makes progress and retry per file for free:
 * `GET /files` says what is still missing, so a run interrupted halfway resumes by
 * sending the rest.
 *
 * Keyed by **filename** and nothing else. Strapi hashes an upload's name
 * (`Mastercard_0a2d4ecc1c.svg`) and writes it flat, so the basename of the `url`
 * column and the name in the operator's directory listing are the same string —
 * which is what lets a browser directory picker be matched against a catalog read
 * on the server with no path mapping in between.
 */
export class UploadStore {
  /** A subdirectory, so `SourceStore`'s sweep of `source-*.db` and this cannot
   *  reach each other's files. */
  private static readonly Directory = 'uploads'

  /** Long enough for anything Strapi generates, short enough that no filesystem
   *  refuses the path this is joined into. */
  private static readonly MaxNameLength = 200

  private readonly directory: string

  constructor(workDir: string) {
    this.directory = path.join(workDir, UploadStore.Directory)
  }

  /**
   * Write one upload.
   *
   * Straight to its final name, overwriting: `fs.writeFile` truncates in place, so
   * there is no rename and no delete — and therefore none of the Windows file
   * locking `SourceStore` has to work around. Nothing here holds a handle between
   * requests either; `read` opens and closes.
   */
  async put(name: string, bytes: Uint8Array): Promise<StagedUpload> {
    const filename = UploadStore.filename(name)
    try {
      await fs.mkdir(this.directory, { recursive: true })
      await fs.writeFile(path.join(this.directory, filename), bytes)
    } catch (caught: any) {
      throw new Error(
        `"${filename}" could not be staged in "${this.directory}": ${caught?.message ?? caught}. ` +
          `Set "work_dir" in this plugin's configuration to a directory it can write.`,
      )
    }
    return { name: filename, bytes: bytes.byteLength }
  }

  /** One upload's bytes, or `null` if it was never supplied. */
  async read(name: string): Promise<Uint8Array | null> {
    let filename: string
    try {
      filename = UploadStore.filename(name)
    } catch {
      // A name the catalog holds that this store could never have staged. Not a
      // failure of the import — the file is simply not here.
      return null
    }
    try {
      return new Uint8Array(await fs.readFile(path.join(this.directory, filename)))
    } catch {
      return null
    }
  }

  /** Every staged upload by name, which is what a `staged` flag on a listing of
   *  wanted files is read from. */
  async index(): Promise<Map<string, number>> {
    const index = new Map<string, number>()
    let entries: string[]
    try {
      entries = await fs.readdir(this.directory)
    } catch {
      return index
    }
    for (const entry of entries) {
      try {
        const stat = await fs.stat(path.join(this.directory, entry))
        if (stat.isFile()) index.set(entry, stat.size)
      } catch {
        // Removed between the listing and the stat. Not staged, then.
      }
    }
    return index
  }

  /** Forget every upload. A missing directory is a success: the outcome asked
   *  for is "they are not there". */
  async clear(): Promise<void> {
    await fs.rm(this.directory, { recursive: true, force: true }).catch(() => {})
  }

  /**
   * A name this store will accept, or a refusal saying what is wrong with it.
   *
   * **Refused rather than sanitised**, which is the choice worth stating. This
   * name reaches `path.join`, so it has to be checked; but a `..` quietly
   * rewritten to `__` would stage the file under a name the import then looks for
   * and does not find, and the operator would see "not supplied" for a file they
   * watched upload. A refusal names the file.
   *
   * The name arrives from the operator's own directory listing by way of the
   * panel, and the panel is a plugin's HTML in somebody's browser reached through
   * a relay that authenticates the operator without vouching for the body — so
   * "the operator sent it" is not a reason to trust it.
   */
  static filename(raw: unknown): string {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value.length === 0) throw new Error('an upload needs a "name"')
    if (value.length > UploadStore.MaxNameLength) {
      throw new Error(`"${value.slice(0, 40)}…" is too long a filename to stage`)
    }
    if (value === '.' || value === '..' || /[/\\:\0]/.test(value)) {
      throw new Error(
        `"${value}" is not a plain filename. Send the name as it appears in Strapi's uploads ` +
          `directory — "logo_a1b2c3.svg", not a path.`,
      )
    }
    return value
  }
}
