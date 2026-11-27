import { ReservedFieldNames } from '@silo/shared/reserved-field-names'

/**
 * Formats, parses, and validates raw JSON entry documents.
 *
 * Keeps raw entry editing scoped strictly to user fields (`ReservedFieldNames`
 * such as `id`, `rev`, `seq`, `created_at`, and `updated_at` are managed by
 * Silo) while preserving `{{NAME}}` variable templates and explicit `null`s.
 */
export class EntryJsonDocument {
  static format(data: Record<string, any> | null | undefined): string {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '{}'
    const userFields = Object.fromEntries(
      Object.entries(data).filter(([key]) => !ReservedFieldNames.is(key)),
    )
    return JSON.stringify(userFields, null, 2)
  }

  static parse(
    text: string,
  ): { ok: true; data: Record<string, any> } | { ok: false; error: string } {
    if (text.trim() === '') {
      return { ok: false, error: 'Entry JSON cannot be empty; enter a JSON object such as {}.' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (caught) {
      return {
        ok: false,
        error: caught instanceof Error ? caught.message : 'Invalid JSON',
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Entry JSON must be a plain JSON object (for example { "title": "..." }).',
      }
    }

    const reserved = ReservedFieldNames.presentIn(parsed)
    if (reserved.length > 0) {
      const names = reserved.map((name) => `"${name}"`).join(', ')
      return {
        ok: false,
        error: `Reserved field${reserved.length === 1 ? '' : 's'} ${names} cannot be edited here (${ReservedFieldNames.All.join(', ')} are managed by Silo).`,
      }
    }

    return { ok: true, data: parsed as Record<string, any> }
  }

  static prettyPrint(text: string): { ok: true; text: string } | { ok: false; error: string } {
    const parsed = EntryJsonDocument.parse(text)
    if (!parsed.ok) return parsed
    return { ok: true, text: EntryJsonDocument.format(parsed.data) }
  }
}
