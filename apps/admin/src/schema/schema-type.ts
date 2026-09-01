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
   * declares none, or genuinely allows two (`["string", "number"]`), which no
   * reader here can render as one thing.
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
   * Whether the declared type names two or more real types (`"null"` aside).
   *
   * This is the case `of` cannot answer, and no single control can draw: it is
   * left to Code view rather than guessed at.
   */
  static isMultiType(property: any): boolean {
    const declared = property?.type
    if (!Array.isArray(declared)) return false
    return declared.filter((type) => typeof type === 'string' && type !== 'null').length > 1
  }

  /** Both of JSON Schema's number types, which every reader here treats alike. */
  static isNumeric(property: any): boolean {
    const type = SchemaType.of(property)
    return type === 'number' || type === 'integer'
  }
}
