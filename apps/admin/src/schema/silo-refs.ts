import { SiloRef } from '@silo/shared/silo-ref'

// SiloRefs prepares a collection schema for RJSF. RJSF (and its ajv8 validator)
// can only follow internal `#/...` pointers, so `$ref: silo://collections/x`
// would crash the renderer and fail client validation. resolveForForm embeds
// every reachable local collection schema under $defs (keyed by its silo:// URL)
// and rewrites refs to internal pointers — rendering and Ajv validation then
// both work with the stock validator. Refs the client can't resolve (remote
// URLs, unknown collections, cycles) are replaced by a permissive marker node
// that the form shows as a raw-JSON field; the server stays authoritative.
//
// What it embeds comes from the **document's own `$defs`** (D54). The server
// bundles every referenced collection's schema in there, transitively, keyed by
// collection name — and re-bundles on the way out, so the copy is current. A
// schema is therefore self-contained, and rendering one entry costs one schema
// rather than every schema in the scope.
export class SiloRefs {
  static readonly markerKey = 'x-silo-unresolved-ref'
  static readonly markerKindKey = 'x-silo-unresolved-kind'

  // Keys whose values are data, not subschemas — never rewritten.
  private static readonly dataKeys = new Set(['enum', 'const', 'default', 'examples', SiloRefs.markerKey, SiloRefs.markerKindKey])

  private static escapePointer(seg: string): string {
    return seg.replace(/~/g, '~0').replace(/\//g, '~1')
  }

  static resolveForForm(rootName: string, schema: any): any {
    if (!schema || typeof schema !== 'object') return { type: 'object' }
    const byName = SiloRefs.bundled(schema)
    const { embedded, blocked } = SiloRefs.reach(rootName, schema, byName)

    const out = SiloRefs.transform(schema, rootName, rootName, byName, blocked)
    delete out.$schema
    if (embedded.size > 0) {
      const defs: any = { ...(out.$defs || {}) }
      for (const name of embedded) {
        const copy = SiloRefs.transform(byName.get(name), name, rootName, byName, blocked)
        delete copy.$schema
        delete copy.$id
        defs[SiloRef.url(name)] = copy
      }
      out.$defs = defs
    }
    return out
  }

  // The collection schemas the server bundled into this document, by name.
  // Anything else in $defs — an author's own definitions, a remote URL — is
  // left alone: only a name a `silo://collections/<name>` ref actually asks for
  // is ever looked up here.
  private static bundled(schema: any): Map<string, any> {
    const defs = schema.$defs
    if (!defs || typeof defs !== 'object') return new Map()
    return new Map(Object.entries(defs))
  }

  // reach walks the silo-ref graph from the root collection: which collections
  // must be embedded, and which edges close a cycle (those refs fall back to
  // the raw-JSON marker so RJSF never renders an infinite tree).
  private static reach(rootName: string, rootSchema: any, byName: Map<string, any>) {
    const embedded = new Set<string>()
    const blocked = new Set<string>()
    const stack = new Set<string>()
    const visit = (name: string, doc: any) => {
      stack.add(name)
      for (const target of SiloRefs.localRefsIn(doc)) {
        if (!byName.has(target)) continue
        if (stack.has(target)) {
          blocked.add(`${name}→${target}`)
          continue
        }
        if (!embedded.has(target)) {
          embedded.add(target)
          visit(target, byName.get(target))
        }
      }
      stack.delete(name)
    }
    visit(rootName, rootSchema)
    embedded.delete(rootName)
    return { embedded, blocked }
  }

  private static localRefsIn(node: any, acc: Set<string> = new Set()): Set<string> {
    if (Array.isArray(node)) {
      for (const v of node) SiloRefs.localRefsIn(v, acc)
    } else if (node && typeof node === 'object') {
      if (SiloRef.isLocal(node.$ref)) acc.add(SiloRef.collectionOf(node.$ref))
      for (const [k, v] of Object.entries(node)) {
        if (!SiloRefs.dataKeys.has(k)) SiloRefs.localRefsIn(v, acc)
      }
    }
    return acc
  }

  // transform deep-copies a schema owned by `owner`, rewriting refs:
  //  - silo:// refs         → #/$defs/<escaped silo URL>[/fragment]
  //  - internal # refs of an *embedded* schema → re-based under its $defs entry
  //  - remote / unknown / cycle-closing refs   → permissive marker node
  private static transform(node: any, owner: string, rootName: string, byName: Map<string, any>, blocked: Set<string>): any {
    if (Array.isArray(node)) {
      return node.map((v) => SiloRefs.transform(v, owner, rootName, byName, blocked))
    }
    if (!node || typeof node !== 'object') return node

    const out: any = {}
    for (const [k, v] of Object.entries(node)) {
      out[k] = SiloRefs.dataKeys.has(k) ? v : SiloRefs.transform(v, owner, rootName, byName, blocked)
    }

    const ref = node.$ref
    if (typeof ref !== 'string') return out

    if (SiloRef.isLocal(ref)) {
      const target = SiloRef.collectionOf(ref)
      if (!byName.has(target)) return SiloRefs.marker(out, ref, 'missing')
      if (blocked.has(`${owner}→${target}`)) return SiloRefs.marker(out, ref, 'cycle')
      const hash = ref.indexOf('#')
      const fragment = hash >= 0 ? ref.slice(hash + 1) : ''
      out.$ref = `#/$defs/${SiloRefs.escapePointer(SiloRef.url(target))}${fragment}`
      return out
    }
    if (ref.startsWith('#')) {
      if (owner !== rootName) {
        out.$ref = `#/$defs/${SiloRefs.escapePointer(SiloRef.url(owner))}${ref.slice(1)}`
      }
      return out
    }
    return SiloRefs.marker(out, ref, SiloRef.isRemote(ref) ? 'remote' : 'missing')
  }

  private static marker(out: any, ref: string, kind: 'remote' | 'missing' | 'cycle'): any {
    delete out.$ref
    out[SiloRefs.markerKey] = ref
    out[SiloRefs.markerKindKey] = kind
    return out
  }
}
