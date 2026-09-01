import { describe, test, expect } from 'bun:test'
import os from 'os'
import path from 'path'
import { PluginSettings } from '../src/worker/plugin-settings'

/**
 * Reading `[plugins.config]`.
 *
 * **Silo does not apply a config schema's `default`.** The manifest advertises
 * `media_folder: "strapi"`, and an operator who never wrote the key gets
 * `undefined` — which read as "the library root" for as long as the fallback here
 * disagreed with the manifest, so every import landed hundreds of hashed Strapi
 * filenames in the root of a library whose owner had been told otherwise. That is
 * what these assertions are for: the default a plugin ships and the default it
 * runs with are the same value.
 */
describe('reading the plugin configuration', () => {
  const settingsFor = (config: Record<string, unknown>) =>
    PluginSettings.read({ config } as any)

  test('an unconfigured plugin gets the defaults its manifest advertises', () => {
    const settings = settingsFor({})
    expect(settings.mediaFolder).toBe('strapi')
    expect(settings.version).toBe('published')
    expect(settings.prefix).toBe('')
    expect(settings.mediaBaseUrl).toBe('')
    expect(settings.workDir).toBe(path.join(os.tmpdir(), 'silo-strapi-import'))
  })

  /** An operator who empties the field means the library root and gets it: a
   *  default is what applies when nobody said, not what overrides them. */
  test('an explicit empty folder is the library root, not the default', () => {
    expect(settingsFor({ media_folder: '' }).mediaFolder).toBe('')
    expect(settingsFor({ media_folder: 'imports/strapi' }).mediaFolder).toBe('imports/strapi')
  })

  test('an unusable version falls back rather than refusing the start', () => {
    expect(settingsFor({ version: 'sideways' }).version).toBe('published')
    expect(settingsFor({ version: 'draft' }).version).toBe('draft')
  })

  test('a blank work_dir is the system temp directory, not a directory named ""', () => {
    expect(settingsFor({ work_dir: '   ' }).workDir).toBe(
      path.join(os.tmpdir(), 'silo-strapi-import'),
    )
    expect(settingsFor({ work_dir: '/srv/staging' }).workDir).toBe('/srv/staging')
  })

  /** Nothing in the configuration names a scope. Where an import goes is chosen
   *  on the plan, against the projects silo actually has. */
  test('no target project or environment is configurable', () => {
    expect(Object.keys(settingsFor({}))).not.toContain('project')
    expect(Object.keys(settingsFor({}))).not.toContain('env')
  })
})
