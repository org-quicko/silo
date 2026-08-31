import type { ConfigField, ConfigSectionView } from '../../../api/types/settings'

/** What one section's form holds. Keyed by TOML key, typed by the spec. */
export type ConfigSectionFields = Record<string, string | number | boolean>

/**
 * The rules one settings card has to get right (D47), kept out of the component
 * so they can be read and tested without a DOM.
 *
 * The seeding rule is the one that matters and it is the same one
 * `MediaStorageDraft` follows: **the form edits the file.** A box seeded from
 * what is in force would offer a value the file never chose, and saving it
 * would write a default or an environment variable's value into the file as
 * though somebody had picked it. Where the file says nothing the box is empty,
 * and what the process is actually using is reported beside it instead.
 */
export class ConfigSectionDraft {
  static of(section: ConfigSectionView): ConfigSectionFields {
    const draft: ConfigSectionFields = {}
    for (const field of section.fields) {
      draft[field.key] = ConfigSectionDraft.value(field, section.file[field.key])
    }
    return draft
  }

  /** One value in the form's own terms: never `undefined`, so a controlled
   *  input cannot flip to uncontrolled while somebody is typing in it. */
  private static value(field: ConfigField, held: unknown): string | number | boolean {
    if (field.type === 'boolean') return held === true
    if (field.type === 'number') return typeof held === 'number' ? held : ''
    return typeof held === 'string' ? held : ''
  }

  static changed(draft: ConfigSectionFields, section: ConfigSectionView): boolean {
    return JSON.stringify(draft) !== JSON.stringify(ConfigSectionDraft.of(section))
  }

  /**
   * The body to save.
   *
   * An empty string is **left out**, not sent as `""`. The server reads an
   * absent key as "the file does not decide this", which is what keeps an
   * unset `[log] file` meaning "the console" rather than a path of zero
   * length. A read-only field is left out too: the server refuses it, and
   * sending one would turn every save of that card into a 400.
   */
  static payload(draft: ConfigSectionFields, section: ConfigSectionView): Record<string, unknown> {
    const body: Record<string, unknown> = {}
    for (const field of section.fields) {
      if (field.readOnly) continue
      const value = draft[field.key]
      if (value === '' || value === undefined) continue
      body[field.key] = value
    }
    return body
  }

  /**
   * What the process is using for a field, when that is not what the form
   * holds. `null` when there is nothing to say, which is the usual case.
   *
   * Two things put a value here, and they read the same to whoever is looking:
   * an override (something outranks the file) and a pending restart (the file
   * has been saved and the process has not picked it up). Both mean "what you
   * see is not what is running", so both are reported the same way.
   */
  static inUse(
    section: ConfigSectionView,
    field: ConfigField,
  ): { value: string; env?: string; restart?: boolean } | null {
    const override = section.overrides.find((each) => each.field === field.key)
    const pending = section.restart_pending.includes(field.key)
    if (!override && !pending) return null

    return {
      value: ConfigSectionDraft.describe(section.in_force[field.key]),
      ...(override?.env ? { env: override.env } : {}),
      ...(pending ? { restart: true } : {}),
    }
  }

  /** A value as a sentence fragment. Empty counts as a value: a field the file
   *  sets and the environment clears is the same surprise as one it changes. */
  private static describe(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'nothing'
    if (typeof value === 'boolean') return value ? 'on' : 'off'
    return String(value)
  }
}
