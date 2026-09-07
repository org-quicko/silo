/**
 * A column heading, from the schema property name behind it.
 *
 * A property is written in code convention — `snake_case`, `camelCase`,
 * sometimes already `Title Case` from a hand-written schema — but the
 * heading it becomes is prose read at a glance, so every convention comes out
 * the same way: words apart, each one capitalized. Sorting and column state
 * still key off the property name itself; this only touches what is drawn.
 */
export class ColumnLabel {
  static of(field: string): string {
    return field
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }
}
