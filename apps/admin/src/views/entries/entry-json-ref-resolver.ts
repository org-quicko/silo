import { SiloRef } from '@silo/shared/silo-ref'
import { SchemaDeref } from '../../schema/schema-deref'

export const UNCHECKED_REF_MARKER = 'x-silo-unchecked-ref'

export interface ResourceEntry {
  baseUrl: string
  root: Record<string, unknown>
  anchors: Map<string, unknown>
}

export interface SanitizedSchemaBundle {
  rootUrl: string
  originalRoot: Record<string, unknown>
  originalBundled: Map<string, Record<string, unknown>>
  resources: Map<string, ResourceEntry>
  uncheckedRefs: string[]
}

const SCHEMA_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
])

const SCHEMA_SINGLE_KEYWORDS = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'contentSchema',
])

const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

/**
 * Resolves and sanitizes local, bundled `silo://collections/*`, `$id`,
 * `$anchor`, and percent-encoded `#/...` references while deferring genuinely
 * unresolvable remote/missing refs without corrupting `not`, `if`, or `oneOf`.
 */
export class EntryJsonRefResolver {
  static prepare(collectionName: string, rawSchema: unknown): SanitizedSchemaBundle {
    const rootInput =
      rawSchema && typeof rawSchema === 'object' && !Array.isArray(rawSchema)
        ? (rawSchema as Record<string, unknown>)
        : { type: 'object' }

    const rootUrl =
      typeof rootInput.$id === 'string' && rootInput.$id.trim() !== ''
        ? rootInput.$id.trim()
        : SiloRef.url(collectionName)
    const bundledMap = EntryJsonRefResolver.extractBundled(rootInput)
    const reachableNames = EntryJsonRefResolver.collectReachableCollections(
      collectionName,
      rootInput,
      bundledMap,
    )

    const resources = new Map<string, ResourceEntry>()
    const uncheckedSet = new Set<string>()

    const originalRoot = EntryJsonRefResolver.sanitizeNode(
      rootInput,
      rootUrl,
      collectionName,
      bundledMap,
      resources,
      uncheckedSet,
      true,
    ) as Record<string, unknown>
    EntryJsonRefResolver.indexResourceTree(originalRoot, rootUrl, resources)

    const originalBundled = new Map<string, Record<string, unknown>>()
    for (const name of reachableNames) {
      const bundledSchema = bundledMap.get(name)
      if (!bundledSchema) continue
      const bundledUrl = SiloRef.url(name)
      const sanitized = EntryJsonRefResolver.sanitizeNode(
        bundledSchema,
        bundledUrl,
        collectionName,
        bundledMap,
        resources,
        uncheckedSet,
        true,
      ) as Record<string, unknown>
      originalBundled.set(name, sanitized)
      EntryJsonRefResolver.indexResourceTree(sanitized, bundledUrl, resources)
    }

    // Re-pass once all resource IDs are indexed so forward/cross-resource
    // relative `$ref`s resolve cleanly against `resources`.
    const finalUnchecked = new Set<string>()
    const resolvedRoot = EntryJsonRefResolver.resolvePass(
      originalRoot,
      rootUrl,
      collectionName,
      originalBundled,
      resources,
      finalUnchecked,
    ) as Record<string, unknown>
    const resolvedBundled = new Map<string, Record<string, unknown>>()
    for (const [name, schema] of originalBundled.entries()) {
      resolvedBundled.set(
        name,
        EntryJsonRefResolver.resolvePass(
          schema,
          SiloRef.url(name),
          collectionName,
          originalBundled,
          resources,
          finalUnchecked,
        ) as Record<string, unknown>,
      )
    }

    return {
      rootUrl,
      originalRoot: resolvedRoot,
      originalBundled: resolvedBundled,
      resources,
      uncheckedRefs: [...finalUnchecked],
    }
  }

  static resolveTarget(
    ref: string,
    currentBaseUrl: string,
    localRoot: Record<string, unknown>,
    bundled: Map<string, Record<string, unknown>>,
    resources: Map<string, ResourceEntry>,
  ): { node: unknown; root: Record<string, unknown>; baseUrl: string } | null {
    const hashIndex = ref.indexOf('#')
    const uriPart = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref
    const fragment = hashIndex >= 0 ? ref.slice(hashIndex + 1) : ''

    let targetRoot = localRoot
    let targetBase = currentBaseUrl

    if (uriPart !== '') {
      if (SiloRef.isLocal(uriPart)) {
        const name = SiloRef.collectionOf(uriPart)
        const bundledRoot = bundled.get(name)
        const resource = resources.get(SiloRef.url(name))
        if (bundledRoot) {
          targetRoot = bundledRoot
          targetBase = SiloRef.url(name)
        } else if (resource) {
          targetRoot = resource.root
          targetBase = resource.baseUrl
        } else {
          return null
        }
      } else {
        const resolvedUri = EntryJsonRefResolver.resolveUri(uriPart, currentBaseUrl)
        const resource = resolvedUri ? resources.get(resolvedUri) : undefined
        if (!resource) return null
        targetRoot = resource.root
        targetBase = resource.baseUrl
      }
    }

    if (fragment === '' || fragment === '/') {
      return { node: targetRoot, root: targetRoot, baseUrl: targetBase }
    }
    if (fragment.startsWith('/')) {
      const node = SchemaDeref.local(`#${fragment}`, targetRoot)
      return node !== null ? { node, root: targetRoot, baseUrl: targetBase } : null
    }

    const entry = resources.get(targetBase)
    const anchored = entry?.anchors.get(fragment)
    return anchored !== undefined ? { node: anchored, root: targetRoot, baseUrl: targetBase } : null
  }

  static containsUncheckedRef(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some((item) => EntryJsonRefResolver.containsUncheckedRef(item))
    const record = node as Record<string, unknown>
    if (record[UNCHECKED_REF_MARKER]) return true
    for (const [key, value] of Object.entries(record)) {
      if (SCHEMA_MAP_KEYWORDS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.values(value).some((sub) => EntryJsonRefResolver.containsUncheckedRef(sub))) return true
      } else if (SCHEMA_SINGLE_KEYWORDS.has(key)) {
        if (EntryJsonRefResolver.containsUncheckedRef(value)) return true
      } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
        if (value.some((sub) => EntryJsonRefResolver.containsUncheckedRef(sub))) return true
      } else if (key === 'items') {
        if (EntryJsonRefResolver.containsUncheckedRef(value)) return true
      }
    }
    return false
  }

  private static extractBundled(root: Record<string, unknown>): Map<string, Record<string, unknown>> {
    const defs = root.$defs
    if (!defs || typeof defs !== 'object' || Array.isArray(defs)) return new Map()
    const map = new Map<string, Record<string, unknown>>()
    for (const [key, value] of Object.entries(defs)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        map.set(key, value as Record<string, unknown>)
      }
    }
    return map
  }

  private static collectReachableCollections(
    rootName: string,
    root: Record<string, unknown>,
    bundled: Map<string, Record<string, unknown>>,
  ): Set<string> {
    const reachable = new Set<string>()
    const visited = new Set<string>([rootName])

    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const item of node) visit(item)
        return
      }
      const record = node as Record<string, unknown>
      if (typeof record.$ref === 'string' && SiloRef.isLocal(record.$ref)) {
        const target = SiloRef.collectionOf(record.$ref)
        if (bundled.has(target) && !visited.has(target)) {
          visited.add(target)
          reachable.add(target)
          visit(bundled.get(target))
        }
      }
      EntryJsonRefResolver.forEachChildSchema(record, visit)
    }

    visit(root)
    return reachable
  }

  private static sanitizeNode(
    node: unknown,
    baseUrl: string,
    rootName: string,
    bundled: Map<string, Record<string, unknown>>,
    resources: Map<string, ResourceEntry>,
    uncheckedRefs: Set<string>,
    isTopLevel: boolean,
  ): unknown {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node

    const record = node as Record<string, unknown>
    let nextBaseUrl = baseUrl
    if (!isTopLevel && typeof record.$id === 'string' && record.$id.trim() !== '') {
      nextBaseUrl = EntryJsonRefResolver.resolveUri(record.$id.trim(), baseUrl) ?? baseUrl
    }

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (isTopLevel && key === '$schema') continue
      if (isTopLevel && key === '$id') continue
      out[key] = EntryJsonRefResolver.transformChildKeywords(key, value, (child) =>
        EntryJsonRefResolver.sanitizeNode(
          child,
          nextBaseUrl,
          rootName,
          bundled,
          resources,
          uncheckedRefs,
          false,
        ),
      )
    }
    return out
  }

  private static resolvePass(
    node: unknown,
    baseUrl: string,
    rootName: string,
    bundled: Map<string, Record<string, unknown>>,
    resources: Map<string, ResourceEntry>,
    uncheckedRefs: Set<string>,
  ): unknown {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node

    const record = node as Record<string, unknown>
    const nextBaseUrl =
      typeof record.$id === 'string' && record.$id.trim() !== ''
        ? (EntryJsonRefResolver.resolveUri(record.$id.trim(), baseUrl) ?? baseUrl)
        : baseUrl

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      out[key] = EntryJsonRefResolver.transformChildKeywords(key, value, (child) =>
        EntryJsonRefResolver.resolvePass(
          child,
          nextBaseUrl,
          rootName,
          bundled,
          resources,
          uncheckedRefs,
        ),
      )
    }

    if (typeof out.$ref === 'string') {
      const ref = out.$ref
      const localRoot = resources.get(baseUrl)?.root ?? (out as Record<string, unknown>)
      const resolvable = EntryJsonRefResolver.canResolveRef(
        ref,
        nextBaseUrl,
        rootName,
        localRoot,
        bundled,
        resources,
      )
      if (!resolvable) {
        uncheckedRefs.add(ref)
        delete out.$ref
        out[UNCHECKED_REF_MARKER] = true
      }
    }

    // Defer applicators whose predicate or exclusivity depends on an unchecked
    // remote/missing `$ref` instead of inverting `not: {}` or failing `oneOf`.
    if (out.not !== undefined && EntryJsonRefResolver.containsUncheckedRef(out.not)) {
      delete out.not
    }
    if (out.if !== undefined && EntryJsonRefResolver.containsUncheckedRef(out.if)) {
      delete out.if
      delete out.then
      delete out.else
    }
    for (const unionKey of ['oneOf', 'anyOf'] as const) {
      if (Array.isArray(out[unionKey]) && out[unionKey].some((b) => EntryJsonRefResolver.containsUncheckedRef(b))) {
        delete out[unionKey]
      }
    }

    return out
  }

  private static canResolveRef(
    ref: string,
    baseUrl: string,
    rootName: string,
    localRoot: Record<string, unknown>,
    bundled: Map<string, Record<string, unknown>>,
    resources: Map<string, ResourceEntry>,
  ): boolean {
    if (ref.startsWith('#')) return true
    if (SiloRef.isLocal(ref)) {
      const target = SiloRef.collectionOf(ref)
      return target === rootName || bundled.has(target)
    }
    const hashIndex = ref.indexOf('#')
    const uriPart = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref
    const resolved = EntryJsonRefResolver.resolveUri(uriPart, baseUrl)
    if (!resolved) return false
    if (resources.has(resolved)) return true
    return EntryJsonRefResolver.resolveTarget(ref, baseUrl, localRoot, bundled, resources) !== null
  }

  private static indexResourceTree(
    root: Record<string, unknown>,
    baseUrl: string,
    resources: Map<string, ResourceEntry>,
  ): void {
    const rootEntry: ResourceEntry = { baseUrl, root, anchors: new Map() }
    resources.set(baseUrl, rootEntry)

    const visit = (node: unknown, currentEntry: ResourceEntry) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return
      const record = node as Record<string, unknown>
      let activeEntry = currentEntry
      if (record !== root && typeof record.$id === 'string' && record.$id.trim() !== '') {
        const subUrl = EntryJsonRefResolver.resolveUri(record.$id.trim(), currentEntry.baseUrl)
        if (subUrl) {
          activeEntry = { baseUrl: subUrl, root: record, anchors: new Map() }
          resources.set(subUrl, activeEntry)
        }
      }
      if (typeof record.$anchor === 'string' && record.$anchor.trim() !== '') {
        activeEntry.anchors.set(record.$anchor.trim(), record)
      }
      EntryJsonRefResolver.forEachChildSchema(record, (child) => visit(child, activeEntry))
    }

    visit(root, rootEntry)
  }

  private static resolveUri(uri: string, baseUrl: string): string | null {
    try {
      return new URL(uri, baseUrl).href
    } catch {
      return null
    }
  }

  private static forEachChildSchema(
    record: Record<string, unknown>,
    fn: (child: unknown) => void,
  ): void {
    for (const [key, value] of Object.entries(record)) {
      if (SCHEMA_MAP_KEYWORDS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const sub of Object.values(value)) fn(sub)
      } else if (key === 'dependencies' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const dep of Object.values(value)) {
          if (dep && typeof dep === 'object' && !Array.isArray(dep)) fn(dep)
        }
      } else if (SCHEMA_SINGLE_KEYWORDS.has(key)) {
        fn(value)
      } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
        for (const item of value) fn(item)
      } else if (key === 'items') {
        if (Array.isArray(value)) {
          for (const item of value) fn(item)
        } else {
          fn(value)
        }
      }
    }
  }

  private static transformChildKeywords(
    key: string,
    value: unknown,
    fn: (child: unknown) => unknown,
  ): unknown {
    if (SCHEMA_MAP_KEYWORDS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const next: Record<string, unknown> = {}
      for (const [subKey, subVal] of Object.entries(value)) {
        next[subKey] = fn(subVal)
      }
      return next
    }
    if (key === 'dependencies' && value && typeof value === 'object' && !Array.isArray(value)) {
      const next: Record<string, unknown> = {}
      for (const [subKey, dep] of Object.entries(value)) {
        next[subKey] = dep && typeof dep === 'object' && !Array.isArray(dep) ? fn(dep) : dep
      }
      return next
    }
    if (SCHEMA_SINGLE_KEYWORDS.has(key)) {
      return fn(value)
    }
    if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
      return value.map((item) => fn(item))
    }
    if (key === 'items') {
      return Array.isArray(value) ? value.map((item) => fn(item)) : fn(value)
    }
    return value
  }
}
