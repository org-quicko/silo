import type { StrapiDatabase } from './strapi-database'

/**
 * The field names of a component, from the one place an export records them.
 *
 * A component's *schema* is not in the export — it lives in the project's
 * `src/components/*.json` — so `StrapiShapes` reads a component's shape from its
 * data, and a field that is declared and never filled has nothing to be read
 * from. That leaves a real gap: `com-quicko-app-store.connection` shows `oauth`,
 * `credential` and `api` in Strapi's own editor, and an export where only
 * `oauth` was ever filled can prove only `oauth`.
 *
 * The content-manager's per-component configuration closes it. It is stored
 * beside the content-type schema in `strapi_core_store_settings`, it carries one
 * `metadatas` key per field of every component the instance has, and `strapi
 * transfer` brings it across. It says **which fields exist** and nothing about
 * their types — so it is enough to keep a field on the imported collection, and
 * not enough to say what goes in it, which is exactly how `StrapiShapes` uses
 * it.
 *
 * Absent, this answers nothing and the shape is what the data proves. Reading it
 * is never load-bearing.
 */
export class StrapiFields {
  private static readonly Table = 'strapi_core_store_settings'
  private static readonly Prefix = 'plugin_content_manager_configuration_components::'

  /** Strapi's own keys, which are not fields of the component. */
  private static readonly Ignored: readonly string[] = ['id', 'documentId']

  /** Every field `uid` declares, or an empty list when the export does not say. */
  static of(source: StrapiDatabase, uid: string): string[] {
    if (!source.hasTable(StrapiFields.Table)) return []

    const rows = source.rows<{ value: string }>(
      `SELECT value FROM "${StrapiFields.Table}" WHERE key = ?`,
      `${StrapiFields.Prefix}${uid}`,
    )
    if (rows.length === 0) return []

    try {
      const metadatas = JSON.parse(rows[0]!.value)?.metadatas ?? {}
      return Object.keys(metadatas).filter((name) => !StrapiFields.Ignored.includes(name))
    } catch {
      // A configuration record that is not JSON says nothing about the component,
      // and it is not this import's job to be the thing that notices.
      return []
    }
  }
}
