/**
 * Follows an internal JSON Pointer (`#/...`) within `root`, returning `null`
 * when the pointer is invalid or missing.
 */
export class SchemaDeref {
  static local(ref: string, root: unknown): any {
    if (!ref.startsWith('#')) return null
    if (ref === '#' || ref === '#/') return root ?? null
    if (!ref.startsWith('#/')) return null

    let current: any = root
    for (const rawSegment of ref.slice(2).split('/')) {
      if (!current || typeof current !== 'object') return null
      let decoded: string
      try {
        decoded = decodeURIComponent(rawSegment)
      } catch {
        decoded = rawSegment
      }
      const key = decoded.replace(/~1/g, '/').replace(/~0/g, '~')
      if (!Object.prototype.hasOwnProperty.call(current, key)) return null
      current = current[key]
    }
    return current ?? null
  }
}
