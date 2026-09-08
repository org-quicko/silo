import type { StrapiMediaFile } from '../strapi/strapi-media'

/** `single`: every upload in the configured folder, today's behaviour.
 *  `by-collection`: a folder per collection under it, and `shared` for a file
 *  more than one collection uses. */
export type MediaLayout = 'single' | 'by-collection'

/**
 * Where one upload lands in silo's library, under the configured layout.
 *
 * **Ownership is exact, not approximated from a component uid.** One component
 * can be nested under two content types, and that is precisely the case
 * `shared` exists for — a filename-only view of "which collection wants this"
 * would have to guess, where `StrapiMediaOwners` already knows from the rows the
 * run is about to write.
 */
export class MediaFolders {
  static readonly Layouts: readonly MediaLayout[] = ['single', 'by-collection']
  /** The folder a file referenced by more than one collection goes to. */
  static readonly Shared = 'shared'

  private readonly root: string
  private readonly layout: MediaLayout
  /** Filled once by `assign`, before the first upload of a `by-collection` run. */
  private owners: ReadonlyMap<string, ReadonlySet<string>> = new Map()

  constructor(options: { root: string; layout: MediaLayout }) {
    this.root = options.root
    this.layout = options.layout
  }

  static isLayout(value: unknown): value is MediaLayout {
    return typeof value === 'string' && (MediaFolders.Layouts as readonly string[]).includes(value)
  }

  /** Record which collections reference each filename. Called once, before the
   *  first upload. */
  assign(owners: ReadonlyMap<string, ReadonlySet<string>>): void {
    this.owners = owners
  }

  /** `''` for the root, else a path without leading or trailing slash, e.g.
   *  `strapi/countries`. */
  folderFor(file: StrapiMediaFile): string {
    if (this.layout === 'single') return this.root

    const owners = this.owners.get(file.name)
    const segment = owners && owners.size === 1 ? [...owners][0]! : MediaFolders.Shared
    return this.root ? `${this.root}/${segment}` : segment
  }
}
