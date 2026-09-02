import { MediaField } from '@silo/shared/media-field'
import { SchemaAccess } from '@silo/shared/schema-access'
import {
  SchemaFieldLabels,
  type SchemaField,
  type SchemaFieldKind,
} from './schema-field'
import { SchemaType } from './schema-type'

/** A schema document parsed into the shape the visual builder edits. */
export interface SchemaDraftState {
  base: any
  fields: SchemaField[]
  auth: boolean
  /** False when the text was not valid JSON — the code view stays authoritative. */
  ok: boolean
}

/**
 * Translates between a JSON Schema document and the flat field list the visual
 * builder shows.
 *
 * The round trip is lossy only where it says so: a property carrying an
 * advanced construct keeps its original subtree untouched, so a visual-mode
 * save never corrupts something the builder cannot draw. A multi-type union
 * (`["string", "number"]`) counts as one of those, alongside
 * `oneOf`/`anyOf`/`allOf` — it has no single control to draw it, and picking a
 * winner would throw the other type away.
 *
 * Nullability is the one part of `type` the builder does draw over: a save
 * rewrites `type` from the field's kind, so `["integer", "null"]` has to be
 * read out and written back deliberately or every field of an imported
 * collection would come back a bare scalar and reject the nulls already
 * stored under it. An enum carries it twice — in `type` and as a member of
 * `enum` — and both are rebuilt from the one flag. The `any` kind is the other half of writing `type`
 * honestly: a property that declares none accepts anything, and the builder
 * says so and writes none back rather than settling on `string`.
 */
export class SchemaDraft {
  static readonly Default = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['title'],
    properties: { title: { type: 'string' } },
  }

  static readonly SchemaUrl = 'https://json-schema.org/draft/2020-12/schema'

  static parse(text: string): SchemaDraftState {
    try {
      const document = JSON.parse(text)
      if (!document || typeof document !== 'object') return SchemaDraft.unparseable()

      const properties = document.properties || {}
      const required: string[] = Array.isArray(document.required) ? document.required : []
      const fields = Object.keys(properties).map((name) =>
        SchemaDraft.toField(name, properties[name], required.includes(name)),
      )
      return { base: document, fields, auth: SchemaAccess.requiresAuth(document), ok: true }
    } catch {
      return SchemaDraft.unparseable()
    }
  }

  /** The field list back as a formatted JSON Schema document. */
  static build(base: any, fields: SchemaField[], auth: boolean): string {
    const properties: any = {}
    const required: string[] = []

    for (const field of fields) {
      const name = field.name.trim()
      if (!name) continue
      properties[name] = SchemaDraft.toProperty(field)
      if (field.required) required.push(name)
    }

    const document: any = { ...base }
    document.$schema = base.$schema || SchemaDraft.SchemaUrl
    document.type = 'object'
    document.properties = properties
    if (required.length) document.required = required
    else delete document.required

    SchemaAccess.setRequiresAuth(document, auth)
    return JSON.stringify(document, null, 2)
  }

  /** A blank field, ready for the author to name. */
  static blankField(): SchemaField {
    return {
      name: '',
      kind: 'string',
      required: false,
      description: '',
      enumValues: [],
      refTarget: '',
      nullable: false,
      raw: {},
    }
  }

  private static unparseable(): SchemaDraftState {
    return { base: {}, fields: [], auth: false, ok: false }
  }

  private static toField(name: string, property: any, required: boolean): SchemaField {
    const directRef = typeof property?.$ref === 'string' ? property.$ref : ''
    // Through SchemaType for the same reason `kindOf` is: a nullable list is
    // declared `["array", "null"]`, and a scalar comparison misses it.
    const itemsRef =
      !directRef &&
      SchemaType.of(property) === 'array' &&
      typeof property?.items?.$ref === 'string'
        ? property.items.$ref
        : ''

    return {
      name,
      kind: SchemaDraft.kindOf(property, directRef, itemsRef),
      required,
      description: property?.description || '',
      // `null` is dropped here and put back on save: it is not a choice an
      // author picks from a list, it is what "nullable" means for an enum.
      enumValues: Array.isArray(property?.enum)
        ? property.enum.filter((value: unknown) => value !== null).map(String)
        : [],
      refTarget: directRef || itemsRef,
      nullable: SchemaType.isNullable(property),
      raw: property || {},
      construct: SchemaDraft.constructOf(property, directRef || itemsRef),
    }
  }

  private static kindOf(property: any, directRef: string, itemsRef: string): SchemaFieldKind {
    if (MediaField.is(property)) return 'media'
    if (directRef) return 'ref'
    if (itemsRef) return 'ref-array'
    if (property?.enum) return 'enum'

    // Read through SchemaType, not off `type`: the keyword is a string *or* an
    // array of them, and the array form is what every imported field carries.
    const type = SchemaType.of(property)
    if (type && SchemaFieldLabels[type as SchemaFieldKind]) return type as SchemaFieldKind
    // No type declared is a state of its own, not a missing `string`.
    if (SchemaType.isUntyped(property)) return 'any'
    return 'string'
  }

  private static constructOf(property: any, ref: string): SchemaField['construct'] {
    if (ref) return undefined
    if (property?.oneOf) return 'oneOf'
    if (property?.anyOf) return 'anyOf'
    if (property?.allOf) return 'allOf'
    if (SchemaType.isUnresolved(property)) return 'type union'
    return undefined
  }

  private static toProperty(field: SchemaField): any {
    const property: any = { ...(field.raw || {}) }

    // Advanced constructs have no visual representation; only the description
    // is editable here, and everything else lives in Code view.
    if (field.construct) return SchemaDraft.withDescription(property, field.description)

    SchemaDraft.applyKind(property, field)
    return SchemaDraft.withDescription(property, field.description)
  }

  private static applyKind(property: any, field: SchemaField): void {
    const drop = (...keys: string[]) => keys.forEach((key) => delete property[key])

    // The kind decides the type, so a nullable property has to be reassembled
    // rather than left to the spread of `raw` this overwrites. Kind and
    // nullability are independent: switching an imported integer to a string
    // keeps it nullable, which is what the rows under it still need.
    const setType = (type: string) => {
      property.type = field.nullable ? [type, 'null'] : type
    }

    switch (field.kind) {
      case 'any':
        // No `type` keyword at all, which is the honest schema for a JSON
        // column: it holds whatever the author put there, and `object` would
        // refuse the arrays that are just as common. Already permits null, so
        // there is no union to rebuild.
        drop('type', 'enum', '$ref', 'items', MediaField.TypeKeyword)
        return
      case 'media':
        setType('string')
        property[MediaField.TypeKeyword] = MediaField.MediaType
        drop('enum', '$ref', 'items')
        return
      case 'ref':
        // A `$ref` carries no type to be nullable, so the fact is kept on the
        // field and reappears if the author picks a drawable kind again.
        drop('type', 'enum', MediaField.TypeKeyword, 'items')
        // An empty target keeps the property permissive until one is picked.
        if (field.refTarget) property.$ref = field.refTarget
        else drop('$ref')
        return
      case 'ref-array':
        setType('array')
        drop('enum', '$ref', MediaField.TypeKeyword)
        if (field.refTarget) property.items = { $ref: field.refTarget }
        else drop('items')
        return
      case 'enum':
        // `type` and `enum` have to agree about null or the field cannot hold
        // one: `["string", "null"]` beside `["a", "b"]` validates nothing, and
        // an imported column whose rows are half empty would start failing on
        // the first save from this editor.
        setType('string')
        property.enum = field.nullable ? [...field.enumValues, null] : field.enumValues
        drop('$ref', 'items', MediaField.TypeKeyword)
        return
      default:
        setType(field.kind)
        drop('enum', '$ref', 'items', MediaField.TypeKeyword)
    }
  }

  private static withDescription(property: any, description: string): any {
    if (description) property.description = description
    else delete property.description
    return property
  }
}
