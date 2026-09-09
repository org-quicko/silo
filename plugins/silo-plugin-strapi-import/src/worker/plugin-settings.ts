import type { SiloContext } from 'silo:api'
import os from 'os'
import path from 'path'
import type { MediaLayout } from '../silo/media-folders'
import { MediaFolders } from '../silo/media-folders'
import type { StrapiVersion } from '../strapi/strapi-versions'
import { StrapiVersions } from '../strapi/strapi-versions'

/**
 * `[plugins.config]`, read once with every default stated.
 *
 * **Silo does not apply a config schema's `default`.** `PluginConfigValidator`
 * validates the operator's table and hands it over as written, so a key nobody
 * set arrives `undefined` and the manifest's `"default"` is documentation for
 * the settings form. This class is therefore the one place a default actually
 * takes effect, and every value here has to match what the manifest advertises.
 *
 * Nothing about *where* an import goes is in here. A target project and
 * environment are chosen on the plan, against the projects that exist — see
 * `SiloTargets`.
 */
export class PluginSettings {
  /** The library root. An import lands where the operator's media library
   *  already is, unless they name a folder — see the manifest's own note. */
  static readonly DefaultMediaFolder = ''

  /** Prepended to every proposed collection name. */
  readonly prefix: string
  /** The Strapi instance still serving the uploads, for a file not supplied. */
  readonly mediaBaseUrl: string
  /** Where in silo's media library supplied uploads land. */
  readonly mediaFolder: string
  /** How uploads are laid out under `mediaFolder` — see `MediaFolders`. */
  readonly mediaLayout: MediaLayout
  /** Which document version the source is read as. */
  readonly version: StrapiVersion
  /** Where the staged `.db` and any supplied uploads are written. */
  readonly workDir: string

  private constructor(config: Record<string, unknown>) {
    this.prefix = PluginSettings.text(config.collection_prefix, '')
    this.mediaBaseUrl = PluginSettings.text(config.media_base_url, '')
    this.mediaFolder = PluginSettings.text(config.media_folder, PluginSettings.DefaultMediaFolder)
    this.mediaLayout = MediaFolders.isLayout(config.media_layout) ? config.media_layout : 'single'
    this.version = StrapiVersions.isVersion(config.version) ? config.version : 'published'
    this.workDir = PluginSettings.text(config.work_dir, '').trim() || PluginSettings.tempDir()
  }

  static read(ctx: SiloContext): PluginSettings {
    return new PluginSettings(ctx.config ?? {})
  }

  /**
   * A configured string, or `fallback` when the key was not set.
   *
   * `??` and not `||`, so an operator who deliberately sets `media_folder = ""`
   * gets the library root rather than the default they were opting out of.
   */
  private static text(raw: unknown, fallback: string): string {
    return raw === undefined || raw === null ? fallback : String(raw)
  }

  /** The staging root when `work_dir` is unset. Not under silo's data directory:
   *  that is the operator's content (D5), and a worker is told its config rather
   *  than its instance's layout. */
  private static tempDir(): string {
    return path.join(os.tmpdir(), 'silo-strapi-import')
  }
}
