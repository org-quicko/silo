import { StrapiColumns } from './strapi-columns'
import type { StrapiList } from './strapi-inventory'
import { StrapiMedia } from './strapi-media'

/**
 * The JSON Schema one list becomes — what a collection is created with.
 *
 * Its own artifact beside `StrapiColumns.schemaFor` and `StrapiMedia.schemaFor`,
 * which are the per-field halves: this is where a whole collection's document is
 * assembled from them, and it is what an operator reads in the schema editor
 * afterwards.
 */
export class StrapiSchema {
  /**
   * **Nothing of Strapi's identity is carried.** This used to add a `strapi_id`
   * holding the source row's id, on the reasoning that provenance is worth
   * keeping; it is not worth a column, because silo mints its own id (D2) and
   * nothing on either side resolves a Strapi one. A re-import matches on content
   * or it does not match at all, which is what the plan's `replace` is for.
   */
  static forList(list: StrapiList): Record<string, unknown> {
    const properties: Record<string, unknown> = {}

    for (const column of list.columns) {
      const schema = StrapiColumns.schemaFor(column)
      if (schema) properties[column.name] = schema
    }
    for (const field of list.media) {
      properties[field.name] = StrapiMedia.schemaFor(field)
    }

    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: list.label,
      description: `Imported from Strapi ${list.contentType}${list.field ? ` (${list.field})` : ''}.`,
      type: 'object',
      properties,
      // Open on purpose. A re-import from a Strapi instance that has since gained
      // a field would otherwise fail every row, and the operator would have to
      // edit a schema to accept data they already have.
      additionalProperties: true,
    }
  }
}
