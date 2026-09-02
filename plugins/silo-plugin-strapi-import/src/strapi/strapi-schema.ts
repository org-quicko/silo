import { StrapiColumns } from './strapi-columns'
import type { StrapiList } from './strapi-inventory'
import { StrapiMedia } from './strapi-media'
import type { StrapiChild, StrapiShape } from './strapi-shape'

/**
 * The JSON Schema one list becomes — what a collection is created with.
 *
 * Its own artifact beside `StrapiColumns.schemaFor` and `StrapiMedia.schemaFor`,
 * which are the per-field halves: this is where a whole collection's document is
 * assembled from them, and it is what an operator reads in the schema editor
 * afterwards.
 *
 * **Components are objects and arrays of objects, at whatever depth the source
 * has them.** That is what makes the generated schema readable as the model it
 * came from: `items` is a list of `validation.item`, each holding a list of
 * `validation.issue`, each holding two media fields — and the admin renders that
 * structure rather than a flat table with the nesting thrown away.
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
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: list.label,
      description: `Imported from Strapi ${list.contentType}.`,
      ...StrapiSchema.object(list.shape),
    }
  }

  /** One shape as an object schema. */
  private static object(shape: StrapiShape): Record<string, unknown> {
    const properties: Record<string, unknown> = {}

    for (const column of shape.columns) {
      const schema = StrapiColumns.schemaFor(column)
      if (schema) properties[column.name] = schema
    }
    for (const field of shape.media) {
      properties[field.name] = StrapiMedia.schemaFor(field)
    }
    for (const child of shape.children) {
      properties[child.field] = StrapiSchema.child(child)
    }
    for (const field of shape.emptyFields) {
      // No `type`, the way a JSON column gets none: this export proved the field
      // exists and could not prove what goes in it, and a guessed type would be
      // the one thing worse than an open one — a field that refuses the data it
      // is for.
      properties[field] = {
        description: 'Declared in Strapi and empty in this export, so its type could not be read.',
      }
    }

    return {
      type: 'object',
      properties,
      // Open on purpose. A re-import from a Strapi instance that has since gained
      // a field would otherwise fail every row, and the operator would have to
      // edit a schema to accept data they already have.
      additionalProperties: true,
    }
  }

  /**
   * One component or dynamic-zone field.
   *
   * A zone is **not** a `oneOf` over its component shapes, which is the obvious
   * spelling and the wrong one: every branch here is an open object, so more than
   * one of them matches any item and `oneOf` fails exactly when the data is
   * right. The items carry Strapi's own `__component` discriminator and stay
   * open, and the components they may hold are named in the description where a
   * human will read them.
   */
  private static child(child: StrapiChild): Record<string, unknown> {
    const held = child.shapes.map((shape) => shape.uid).join(', ')

    if (child.kind === 'zone') {
      return {
        type: 'array',
        items: {
          type: 'object',
          properties: { __component: { type: 'string' } },
          additionalProperties: true,
        },
        description: `Imported from a Strapi dynamic zone holding ${held || 'nothing this export could read'}.`,
      }
    }

    const shape = child.shapes[0]
    if (!shape) {
      // Every component this field names was unresolvable. The field is kept and
      // left open rather than dropped, so a re-import against an export the
      // tables can be proved in does not need a schema change.
      return { description: `Imported from a Strapi component field this export could not read.` }
    }

    const object = StrapiSchema.object(shape)
    if (child.kind === 'repeatable') {
      return {
        type: 'array',
        items: object,
        description: `Imported from a repeatable Strapi component, ${shape.uid}.`,
      }
    }
    // Nullable, because a single component nobody filled is `null` and an absent
    // key would read the same as a cleared one.
    return { ...object, type: ['object', 'null'], description: `Imported from the Strapi component ${shape.uid}.` }
  }
}
