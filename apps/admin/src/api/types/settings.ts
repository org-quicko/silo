import type { SettingsOverride } from './media-storage'

/**
 * The rest of `silo.toml`, read and changed through the API (D47).
 *
 * The field list travels **from the server**, which is the point: a new setting
 * is added to `ConfigSections` there and appears here with its label, its type
 * and its restart behaviour intact. A settings page that had to be edited in
 * two places to show a field is how a field ends up saved but never shown.
 */
export interface ConfigField {
  key: string
  type: 'string' | 'boolean' | 'number' | 'enum'
  values?: string[]
  env?: string
  /** Takes effect only at the next start. Per field, not per section: a log
   *  level is read on every line, a log file is opened once. */
  restart?: boolean
  /** Shown, never written. `[storage]` is the instance, not a preference. */
  readOnly?: boolean
  label: string
  help?: string
  min?: number
  zeroMeans?: string
}

/** One `[table]`, with what the file says and what the process is running on. */
export interface ConfigSectionView {
  table: string
  title: string
  summary: string
  fields: ConfigField[]
  /** Only what the file names, so an untouched field is not reported as chosen. */
  file: Record<string, unknown>
  in_force: Record<string, unknown>
  overrides: SettingsOverride[]
  writable: boolean
  /** Saved fields still waiting for a restart. */
  restart_pending: string[]
}

/** What `GET /api/settings` returns. */
export interface ConfigSettingsView {
  sections: ConfigSectionView[]
  config_path?: string
  writable: boolean
  restart_pending: boolean
}
