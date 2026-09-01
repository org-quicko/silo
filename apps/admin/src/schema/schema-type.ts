/**
 * What type a JSON Schema property declares, read as the union JSON Schema
 * allows it to be. `type` is a string *or an array of them*, and the array form
 * is what every nullable field carries — `{ "type": ["integer", "null"] }` is
 * what the Strapi importer writes for every column — so a read that compares
 * `type` against `'integer'` is false for exactly the fields real imported
 * content has.
 */
export class SchemaType {
  /**
   * The single type a property is, `"null"` dropped — or `null` when it
   * declares none, or names anything other than one real type
   * (`["string", "number"]`), which no reader here can render as one thing.
   * `isUntyped` and `isUnresolved` tell those two apart.
   */
  static of(property: any): string | null {
    const declared = property?.type
    if (typeof declared === 'string') return declared
    if (!Array.isArray(declared)) return null
    const named = declared.filter((type) => typeof type === 'string' && type !== 'null')
    return named.length === 1 ? named[0] : null
  }

  /**
   * Whether the declared type is a union carrying `"null"`.
   *
   * A reader that only wants the kind can ignore this; a *writer* cannot. The
   * visual schema builder rewrites `type` from the kind it drew, so unless the
   * nullability comes back out with it, saving an imported collection strips
   * the nulls its rows already hold.
   */
  static isNullable(property: any): boolean {
    const declared = property?.type
    return Array.isArray(declared) && declared.includes('null')
  }

  /**
   * Whether the property declares no type at all.
   *
   * A real state, not a malformed one: the honest schema for a Strapi `json`
   * column is "anything", and narrowing it to `object` would refuse the arrays
   * that are just as common. Distinct from the union `of` cannot resolve,
   * which declares *too much* rather than nothing.
   */
  static isUntyped(property: any): boolean {
    const declared = property?.type
    return !(typeof declared === 'string' || Array.isArray(declared))
  }

  /**
   * Whether `type` is an array form `of` cannot resolve to one type: two or
   * more real ones (`["string", "number"]`), or none (`["null"]`).
   *
   * With `of` and `isUntyped` this makes the classification total — every
   * shape `type` can take has one answer — so a writer never has to fall back
   * on a guess.
   */
  static isUnresolved(property: any): boolean {
    const declared = property?.type
    if (!Array.isArray(declared)) return false
    return declared.filter((type) => typeof type === 'string' && type !== 'null').length !== 1
  }

  /** Both of JSON Schema's number types, which every reader here treats alike. */
  static isNumeric(property: any): boolean {
    const type = SchemaType.of(property)
    return type === 'number' || type === 'integer'
  }
}
