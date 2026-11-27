import {
  EntryJsonRefResolver,
  UNCHECKED_REF_MARKER,
  type ResourceEntry,
} from './entry-json-ref-resolver'

export type SchemaDialect = '2020-12' | 'draft-07' | 'unsupported'

export interface PreparedEntrySchema {
  dialect: SchemaDialect
  rootUrl: string
  originalRoot: Record<string, unknown>
  strictRoot: Record<string, unknown>
  originalBundled: Map<string, Record<string, unknown>>
  strictBundled: Map<string, Record<string, unknown>>
  uncheckedRefs: string[]
}

const PREDICATE_ONLY_KEYWORDS = new Set(['if', 'contains', 'not'])
const BRANCH_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf'])
const DRAFT07_COMPOSITION_KEYWORDS = [
  'allOf',
  'anyOf',
  'oneOf',
  'if',
  'then',
  'else',
  '$ref',
  'not',
  'dependencies',
  'dependentSchemas',
]

/**
 * Derives a strict validation schema from a collection's JSON Schema without
 * mutating the stored schema.
 *
 * Uses `EntryJsonRefResolver` for `$id`/`$anchor`/bundled-`silo://` resolution,
 * preserves `if`/`contains`/`not` predicate subtrees untouched, and closes
 * complete structured object use-sites (`unevaluatedProperties: false` in
 * 2020-12, `additionalProperties: false` on non-composed Draft-07 objects)
 * while leaving `any` (`{}`) and free-form `{ type: "object" }` fields open.
 */
export class EntryJsonSchema {
  static prepare(collectionName: string, rawSchema: unknown): PreparedEntrySchema {
    const rootInput =
      rawSchema && typeof rawSchema === 'object' && !Array.isArray(rawSchema)
        ? (rawSchema as Record<string, unknown>)
        : { type: 'object' }

    const dialect = EntryJsonSchema.detectDialect(rootInput.$schema)
    const bundle = EntryJsonRefResolver.prepare(collectionName, rootInput)

    const strictRoot = EntryJsonSchema.transformStrict(
      bundle.originalRoot,
      dialect,
      bundle.rootUrl,
      bundle.originalRoot,
      bundle.originalBundled,
      bundle.resources,
      true,
      'enforce',
    ) as Record<string, unknown>

    const strictBundled = new Map<string, Record<string, unknown>>()
    for (const [name, sanitized] of bundle.originalBundled.entries()) {
      const baseUrl = `silo://collections/${name}`
      strictBundled.set(
        name,
        EntryJsonSchema.transformStrict(
          sanitized,
          dialect,
          baseUrl,
          sanitized,
          bundle.originalBundled,
          bundle.resources,
          false,
          'enforce',
        ) as Record<string, unknown>,
      )
    }

    EntryJsonSchema.stripMarker(bundle.originalRoot)
    EntryJsonSchema.stripMarker(strictRoot)
    for (const item of bundle.originalBundled.values()) EntryJsonSchema.stripMarker(item)
    for (const item of strictBundled.values()) EntryJsonSchema.stripMarker(item)

    return {
      dialect,
      rootUrl: bundle.rootUrl,
      originalRoot: bundle.originalRoot,
      strictRoot,
      originalBundled: bundle.originalBundled,
      strictBundled,
      uncheckedRefs: bundle.uncheckedRefs,
    }
  }

  private static detectDialect(rawDollarSchema: unknown): SchemaDialect {
    if (typeof rawDollarSchema !== 'string' || rawDollarSchema.trim() === '') {
      return '2020-12'
    }
    const normalized = rawDollarSchema.trim().toLowerCase()
    if (normalized.includes('2020-12')) return '2020-12'
    if (normalized.includes('draft-07') || normalized.includes('draft-7')) return 'draft-07'
    return 'unsupported'
  }

  private static transformStrict(
    node: unknown,
    dialect: SchemaDialect,
    baseUrl: string,
    localRoot: Record<string, unknown>,
    bundled: Map<string, Record<string, unknown>>,
    resources: Map<string, ResourceEntry>,
    isUseSite: boolean,
    mode: 'enforce' | 'predicate',
  ): unknown {
    if (typeof node === 'boolean' || !node || typeof node !== 'object' || Array.isArray(node)) {
      return node
    }

    const record = node as Record<string, unknown>
    const activeBase =
      typeof record.$id === 'string' && record.$id.trim() !== ''
        ? EntryJsonSchema.resolveBase(record.$id.trim(), baseUrl)
        : baseUrl
    const activeRoot = resources.get(activeBase)?.root ?? localRoot

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'properties' || key === 'patternProperties') {
        out[key] = EntryJsonSchema.mapRecord(value, (sub) =>
          EntryJsonSchema.transformStrict(
            sub,
            dialect,
            activeBase,
            activeRoot,
            bundled,
            resources,
            mode === 'enforce',
            mode,
          ),
        )
      } else if (key === '$defs' || key === 'definitions' || key === 'dependentSchemas') {
        out[key] = EntryJsonSchema.mapRecord(value, (sub) =>
          EntryJsonSchema.transformStrict(
            sub,
            dialect,
            activeBase,
            activeRoot,
            bundled,
            resources,
            false,
            mode,
          ),
        )
      } else if (key === 'dependencies' && value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = EntryJsonSchema.mapRecord(value, (dep) =>
          dep && typeof dep === 'object' && !Array.isArray(dep)
            ? EntryJsonSchema.transformStrict(dep, dialect, activeBase, activeRoot, bundled, resources, false, mode)
            : dep,
        )
      } else if (key === 'items') {
        out[key] = Array.isArray(value)
          ? value.map((item) =>
              EntryJsonSchema.transformStrict(
                item,
                dialect,
                activeBase,
                activeRoot,
                bundled,
                resources,
                mode === 'enforce',
                mode,
              ),
            )
          : EntryJsonSchema.transformStrict(
              value,
              dialect,
              activeBase,
              activeRoot,
              bundled,
              resources,
              mode === 'enforce',
              mode,
            )
      } else if (key === 'prefixItems' && Array.isArray(value)) {
        out[key] = value.map((item) =>
          EntryJsonSchema.transformStrict(
            item,
            dialect,
            activeBase,
            activeRoot,
            bundled,
            resources,
            mode === 'enforce',
            mode,
          ),
        )
      } else if (
        (key === 'additionalProperties' ||
          key === 'unevaluatedProperties' ||
          key === 'unevaluatedItems' ||
          key === 'contentSchema') &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        out[key] = EntryJsonSchema.transformStrict(
          value,
          dialect,
          activeBase,
          activeRoot,
          bundled,
          resources,
          mode === 'enforce',
          mode,
        )
      } else if (PREDICATE_ONLY_KEYWORDS.has(key)) {
        out[key] = EntryJsonSchema.transformStrict(
          value,
          dialect,
          activeBase,
          activeRoot,
          bundled,
          resources,
          false,
          'predicate',
        )
      } else if (key === 'then' || key === 'else') {
        out[key] = EntryJsonSchema.transformStrict(
          value,
          dialect,
          activeBase,
          activeRoot,
          bundled,
          resources,
          false,
          mode,
        )
      } else if (BRANCH_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
        out[key] = value.map((branch) =>
          EntryJsonSchema.transformStrict(
            branch,
            dialect,
            activeBase,
            activeRoot,
            bundled,
            resources,
            false,
            mode,
          ),
        )
      } else {
        out[key] = value
      }
    }

    if (
      mode === 'enforce' &&
      isUseSite &&
      !Object.prototype.hasOwnProperty.call(out, 'additionalProperties') &&
      !Object.prototype.hasOwnProperty.call(out, 'unevaluatedProperties')
    ) {
      if (dialect === '2020-12') {
        if (
          !out[UNCHECKED_REF_MARKER] &&
          out.not === undefined &&
          EntryJsonSchema.isClosedStructuredObject(
            record,
            activeBase,
            activeRoot,
            bundled,
            resources,
            new Set(),
          )
        ) {
          out.unevaluatedProperties = false
        }
      } else if (dialect === 'draft-07') {
        const hasDeclaredProps =
          (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) ||
          (record.patternProperties &&
            typeof record.patternProperties === 'object' &&
            !Array.isArray(record.patternProperties))
        const hasComposition = DRAFT07_COMPOSITION_KEYWORDS.some((kw) => kw in record)
        if (!out[UNCHECKED_REF_MARKER] && hasDeclaredProps && !hasComposition) {
          out.additionalProperties = false
        }
      }
    }

    return out
  }

  private static isClosedStructuredObject(
    node: unknown,
    baseUrl: string,
    localRoot: Record<string, unknown>,
    bundled: Map<string, Record<string, unknown>>,
    resources: Map<string, ResourceEntry>,
    visited: Set<unknown>,
  ): boolean {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    if (visited.has(node)) return false
    visited.add(node)

    const record = node as Record<string, unknown>
    if (record[UNCHECKED_REF_MARKER]) return false

    if (
      (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) ||
      (record.patternProperties &&
        typeof record.patternProperties === 'object' &&
        !Array.isArray(record.patternProperties))
    ) {
      return true
    }

    if (typeof record.$ref === 'string') {
      const target = EntryJsonRefResolver.resolveTarget(
        record.$ref,
        baseUrl,
        localRoot,
        bundled,
        resources,
      )
      if (
        target &&
        EntryJsonSchema.isClosedStructuredObject(
          target.node,
          target.baseUrl,
          target.root,
          bundled,
          resources,
          visited,
        )
      ) {
        return true
      }
    }

    if (Array.isArray(record.allOf)) {
      for (const branch of record.allOf) {
        if (
          EntryJsonSchema.isClosedStructuredObject(
            branch,
            baseUrl,
            localRoot,
            bundled,
            resources,
            visited,
          )
        ) {
          return true
        }
      }
    }

    for (const unionKeyword of ['anyOf', 'oneOf'] as const) {
      const branches = record[unionKeyword]
      if (!Array.isArray(branches) || branches.length === 0) continue

      let hasStructuredBranch = false
      let hasFreeObjectBranch = false
      for (const branch of branches) {
        if (branch === true) {
          hasFreeObjectBranch = true
          continue
        }
        if (branch === false || !branch || typeof branch !== 'object' || Array.isArray(branch)) {
          continue
        }
        const branchRecord = branch as Record<string, unknown>
        if (
          EntryJsonSchema.isClosedStructuredObject(
            branchRecord,
            baseUrl,
            localRoot,
            bundled,
            resources,
            visited,
          )
        ) {
          hasStructuredBranch = true
        } else if (EntryJsonSchema.mayAcceptArbitraryObject(branchRecord)) {
          hasFreeObjectBranch = true
        }
      }
      if (hasStructuredBranch && !hasFreeObjectBranch) {
        return true
      }
    }

    return false
  }

  private static mayAcceptArbitraryObject(branch: Record<string, unknown>): boolean {
    if (branch[UNCHECKED_REF_MARKER]) return true
    if (branch.type === undefined) return true
    if (branch.type === 'object') return true
    if (Array.isArray(branch.type) && branch.type.includes('object')) return true
    return false
  }

  private static mapRecord(
    value: unknown,
    mapper: (sub: unknown) => unknown,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      next[key] = mapper(item)
    }
    return next
  }

  private static resolveBase(id: string, parentBase: string): string {
    try {
      return new URL(id, parentBase).href
    } catch {
      return parentBase
    }
  }

  private static stripMarker(node: unknown): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) EntryJsonSchema.stripMarker(item)
      return
    }
    const record = node as Record<string, unknown>
    delete record[UNCHECKED_REF_MARKER]
    for (const value of Object.values(record)) {
      EntryJsonSchema.stripMarker(value)
    }
  }
}
