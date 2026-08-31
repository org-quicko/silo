import type {
  MediaStorageFacts,
  MediaStorageInput,
  MediaStorageView,
} from '../../../api/types/media-storage'

/**
 * The editable half of a media storage configuration.
 *
 * Empty strings rather than `undefined`, so a controlled input never flips
 * between controlled and uncontrolled while somebody is typing in it. The
 * server reads `''` as "not set", which is the same thing the file means by
 * leaving a key out.
 */
export interface MediaStorageFields {
  driver: string
  path: string
  bucket: string
  region: string
  endpoint: string
  access_key_id: string
  force_path_style: boolean
}

/**
 * The rules the media storage form has to get right, kept out of the component
 * so they can be read and tested without a DOM.
 *
 * There are only two, and both are about not lying: the form edits **the file**
 * rather than the configuration in force, and which fields it shows follows the
 * driver rather than an assumption about what a driver reads.
 */
export class MediaStorageDraft {
  /**
   * What a stored secret shows in its box. A fixed width rather than the real
   * one, because the length of a credential is itself worth not publishing.
   */
  static readonly SecretMask = '••••••••••'

  /**
   * A draft of what the file holds.
   *
   * Never of what is in force. The fs media path is `<data dir>/media`
   * precisely while nobody has named one, so seeding from the running
   * configuration would put a derived value in the box and save it back as a
   * literal, pinning media in place and quietly breaking `--data`.
   */
  static of(facts: MediaStorageFacts): MediaStorageFields {
    return {
      driver: facts.driver,
      path: facts.path ?? '',
      bucket: facts.bucket ?? '',
      region: facts.region ?? '',
      endpoint: facts.endpoint ?? '',
      access_key_id: facts.access_key_id ?? '',
      force_path_style: facts.force_path_style ?? false,
    }
  }

  /** Whether anything in the draft differs from the file it was seeded with. */
  static changed(draft: MediaStorageFields, facts: MediaStorageFacts): boolean {
    return JSON.stringify(draft) !== JSON.stringify(MediaStorageDraft.of(facts))
  }

  /**
   * The body to save.
   *
   * The secret is the only field with three states, and the precedence between
   * them is the point: a typed value wins over a pending clear, because
   * clearing the stored one is how the box is opened for typing in the first
   * place. Sending nothing keeps what the file holds; `''` is the only way to
   * remove one.
   */
  static payload(
    draft: MediaStorageFields,
    secret: string,
    cleared: boolean,
  ): MediaStorageInput {
    if (secret) return { ...draft, secret_access_key: secret }
    if (cleared) return { ...draft, secret_access_key: '' }
    return { ...draft }
  }

  /**
   * Which groups of fields a driver takes.
   *
   * `fs` takes a directory and `s3` takes a bucket and a credential. A driver
   * this build learned from a provider plugin gets **both**, because every
   * driver is handed the same `[blob_storage]` table and the admin has no way
   * to know which of its keys that plugin reads. Showing too much is a worse
   * page; showing too little is an unconfigurable one.
   */
  static shows(driver: string): { directory: boolean; bucket: boolean } {
    const known = driver === 'fs' || driver === 's3'
    return { directory: !known || driver === 'fs', bucket: !known || driver === 's3' }
  }

  /**
   * The providers to offer.
   *
   * Whatever the file names stays in the list even when this build can no
   * longer open it, which happens when a provider plugin is uninstalled: a
   * select that dropped the current value would silently propose changing the
   * driver, and the operator would save that without ever choosing it.
   */
  static options(view: MediaStorageView): string[] {
    const driver = view.file.driver
    return view.drivers.includes(driver) ? view.drivers : [...view.drivers, driver]
  }

  /**
   * What the server is using for one field, when that is not what the file
   * says. `null` when the file decides it, which is the usual case.
   *
   * Empty counts as a value: a field the file sets and the environment clears
   * is the same surprise as one it changes, and reporting nothing there would
   * be the page agreeing with the form against the truth.
   */
  static inUse(view: MediaStorageView, field: string): { value: string; env?: string } | null {
    const override = view.overrides.find((each) => each.field === field)
    if (!override) return null

    // The secret is never reported, so there is nothing to print but the fact
    // that a different one is in force.
    if (field === 'secret_access_key') {
      return { value: 'a different secret', ...(override.env ? { env: override.env } : {}) }
    }

    const value = (view.in_force as unknown as Record<string, unknown>)[field]
    return {
      value:
        value === undefined || value === null || value === ''
          ? 'nothing'
          : typeof value === 'boolean'
            ? value
              ? 'on'
              : 'off'
            : String(value),
      ...(override.env ? { env: override.env } : {}),
    }
  }
}
