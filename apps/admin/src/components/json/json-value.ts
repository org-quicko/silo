export type JsonConcreteType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export type JsonValueType = JsonConcreteType | 'empty'

export type JsonPathSegment = string | number

/**
 * Immutable JSON value inspection, type coercion, path mutation, and
 * collapse-depth helpers powering the visual JSON/any tree builder.
 */
export class JsonValue {
  static typeOf(value: unknown): JsonValueType {
    if (value === undefined) return 'empty'
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    const kind = typeof value
    if (kind === 'object') return 'object'
    if (kind === 'string') return 'string'
    if (kind === 'number') return 'number'
    if (kind === 'boolean') return 'boolean'
    return 'null'
  }

  static defaultFor(type: JsonConcreteType): unknown {
    switch (type) {
      case 'object':
        return {}
      case 'array':
        return []
      case 'string':
        return ''
      case 'number':
        return 0
      case 'boolean':
        return false
      case 'null':
        return null
    }
  }

  static coerce(value: unknown, target: JsonConcreteType): unknown {
    switch (target) {
      case 'string': {
        if (value === undefined || value === null) return ''
        if (typeof value === 'string') return value
        if (typeof value === 'number' || typeof value === 'boolean') return String(value)
        return JSON.stringify(value)
      }
      case 'number': {
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0
        if (typeof value === 'boolean') return value ? 1 : 0
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (trimmed !== '') {
            const parsed = Number(trimmed)
            if (Number.isFinite(parsed)) return parsed
          }
        }
        return 0
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value
        if (typeof value === 'string') {
          const trimmed = value.trim().toLowerCase()
          if (trimmed === 'true') return true
          if (trimmed === 'false') return false
          return Boolean(value.trim())
        }
        if (typeof value === 'number') return value !== 0
        return false
      }
      case 'null':
        return null
      case 'object': {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
        if (Array.isArray(value)) {
          return Object.fromEntries(value.map((item, index) => [String(index), item]))
        }
        return {}
      }
      case 'array': {
        if (Array.isArray(value)) return value
        if (value !== null && typeof value === 'object') {
          return Object.values(value as Record<string, unknown>)
        }
        if (value === undefined) return []
        return [value]
      }
    }
  }

  static pathKey(path: readonly JsonPathSegment[]): string {
    return JSON.stringify(path)
  }

  static nextKey(record: Record<string, unknown>, base = 'key'): string {
    if (!Object.prototype.hasOwnProperty.call(record, base)) return base
    let suffix = 2
    while (Object.prototype.hasOwnProperty.call(record, `${base}_${suffix}`)) {
      suffix++
    }
    return `${base}_${suffix}`
  }

  static setAt(root: unknown, path: readonly JsonPathSegment[], nextValue: unknown): unknown {
    if (path.length === 0) return nextValue
    const [head, ...rest] = path

    if (typeof head === 'number' && Array.isArray(root)) {
      if (head < 0 || head >= root.length) return root
      const clone = [...root]
      clone[head] = JsonValue.setAt(clone[head], rest, nextValue)
      return clone
    }

    if (typeof head === 'string' && root !== null && typeof root === 'object' && !Array.isArray(root)) {
      const record = root as Record<string, unknown>
      return {
        ...record,
        [head]: JsonValue.setAt(record[head], rest, nextValue),
      }
    }

    return root
  }

  static removeAt(root: unknown, path: readonly JsonPathSegment[]): unknown {
    if (path.length === 0) return undefined
    const [head, ...rest] = path

    if (rest.length === 0) {
      if (typeof head === 'number' && Array.isArray(root)) {
        if (head < 0 || head >= root.length) return root
        return root.filter((_, index) => index !== head)
      }
      if (typeof head === 'string' && root !== null && typeof root === 'object' && !Array.isArray(root)) {
        const record = root as Record<string, unknown>
        if (!Object.prototype.hasOwnProperty.call(record, head)) return root
        return Object.fromEntries(Object.entries(record).filter(([key]) => key !== head))
      }
      return root
    }

    if (typeof head === 'number' && Array.isArray(root)) {
      if (head < 0 || head >= root.length) return root
      const clone = [...root]
      clone[head] = JsonValue.removeAt(clone[head], rest)
      return clone
    }

    if (typeof head === 'string' && root !== null && typeof root === 'object' && !Array.isArray(root)) {
      const record = root as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(record, head)) return root
      return {
        ...record,
        [head]: JsonValue.removeAt(record[head], rest),
      }
    }

    return root
  }

  static renameKeyAt(
    root: unknown,
    objectPath: readonly JsonPathSegment[],
    oldKey: string,
    newKey: string,
  ): { ok: true; value: unknown } | { ok: false; error: string } {
    const target = JsonValue.getAt(root, objectPath)
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      return { ok: false, error: 'Target is not an object.' }
    }
    const record = target as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, oldKey)) {
      return { ok: false, error: `Key "${oldKey}" does not exist.` }
    }
    if (newKey === oldKey) {
      return { ok: true, value: root }
    }
    if (Object.prototype.hasOwnProperty.call(record, newKey)) {
      return { ok: false, error: `Key "${newKey}" already exists.` }
    }

    const rebuilt = Object.fromEntries(
      Object.entries(record).map(([key, entryValue]) => [key === oldKey ? newKey : key, entryValue]),
    )
    return { ok: true, value: JsonValue.setAt(root, objectPath, rebuilt) }
  }

  static addObjectProperty(
    root: unknown,
    objectPath: readonly JsonPathSegment[],
    preferredKey = 'key',
  ): { value: unknown; key: string } {
    const target = JsonValue.getAt(root, objectPath)
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      return { value: root, key: preferredKey }
    }
    const record = target as Record<string, unknown>
    const key = JsonValue.nextKey(record, preferredKey)
    const updated = { ...record, [key]: '' }
    return { value: JsonValue.setAt(root, objectPath, updated), key }
  }

  static addArrayItem(
    root: unknown,
    arrayPath: readonly JsonPathSegment[],
    initialValue: unknown = '',
  ): { value: unknown; index: number } {
    const target = JsonValue.getAt(root, arrayPath)
    if (!Array.isArray(target)) {
      return { value: root, index: -1 }
    }
    const nextArray = [...target, JsonValue.clone(initialValue)]
    return { value: JsonValue.setAt(root, arrayPath, nextArray), index: nextArray.length - 1 }
  }

  static moveArrayItem(
    root: unknown,
    arrayPath: readonly JsonPathSegment[],
    fromIndex: number,
    toIndex: number,
  ): unknown {
    const target = JsonValue.getAt(root, arrayPath)
    if (!Array.isArray(target)) return root
    if (
      fromIndex < 0 ||
      fromIndex >= target.length ||
      toIndex < 0 ||
      toIndex >= target.length ||
      fromIndex === toIndex
    ) {
      return root
    }
    const nextArray = [...target]
    const [moved] = nextArray.splice(fromIndex, 1)
    nextArray.splice(toIndex, 0, moved)
    return JsonValue.setAt(root, arrayPath, nextArray)
  }

  static duplicateAt(root: unknown, path: readonly JsonPathSegment[]): unknown {
    if (path.length === 0) return JsonValue.clone(root)
    const parentPath = path.slice(0, -1)
    const lastSegment = path[path.length - 1]
    const parent = JsonValue.getAt(root, parentPath)

    if (typeof lastSegment === 'number' && Array.isArray(parent)) {
      if (lastSegment < 0 || lastSegment >= parent.length) return root
      const nextArray = [...parent]
      nextArray.splice(lastSegment + 1, 0, JsonValue.clone(parent[lastSegment]))
      return JsonValue.setAt(root, parentPath, nextArray)
    }

    if (
      typeof lastSegment === 'string' &&
      parent !== null &&
      typeof parent === 'object' &&
      !Array.isArray(parent)
    ) {
      const record = parent as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(record, lastSegment)) return root
      const copyKey = JsonValue.nextKey(record, `${lastSegment}_copy`)
      const entries: [string, unknown][] = []
      for (const [key, entryValue] of Object.entries(record)) {
        entries.push([key, entryValue])
        if (key === lastSegment) {
          entries.push([copyKey, JsonValue.clone(entryValue)])
        }
      }
      return JsonValue.setAt(root, parentPath, Object.fromEntries(entries))
    }

    return root
  }

  static countNodes(value: unknown, limit = Number.POSITIVE_INFINITY): number {
    if (value === undefined) return 0
    let count = 0
    const stack: unknown[] = [value]
    while (stack.length > 0) {
      const current = stack.pop()
      count++
      if (count > limit) return count
      if (Array.isArray(current)) {
        for (let index = current.length - 1; index >= 0; index--) {
          stack.push(current[index])
        }
      } else if (current !== null && typeof current === 'object') {
        const values = Object.values(current as Record<string, unknown>)
        for (let index = values.length - 1; index >= 0; index--) {
          stack.push(values[index])
        }
      }
    }
    return count
  }

  static collectContainerPaths(value: unknown, path: readonly JsonPathSegment[] = []): string[] {
    const result: string[] = []
    if (Array.isArray(value)) {
      if (path.length > 0) result.push(JsonValue.pathKey(path))
      value.forEach((item, index) => {
        result.push(...JsonValue.collectContainerPaths(item, [...path, index]))
      })
    } else if (value !== null && typeof value === 'object') {
      if (path.length > 0) result.push(JsonValue.pathKey(path))
      for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
        result.push(...JsonValue.collectContainerPaths(childValue, [...path, key]))
      }
    }
    return result
  }

  static defaultCollapsedPaths(value: unknown, maxOpenDepth = 2): Set<string> {
    const collapsed = new Set<string>()
    const visit = (node: unknown, path: readonly JsonPathSegment[], depth: number) => {
      if (Array.isArray(node)) {
        if (path.length > 0 && depth >= maxOpenDepth) {
          collapsed.add(JsonValue.pathKey(path))
        }
        node.forEach((item, index) => visit(item, [...path, index], depth + 1))
      } else if (node !== null && typeof node === 'object') {
        if (path.length > 0 && depth >= maxOpenDepth) {
          collapsed.add(JsonValue.pathKey(path))
        }
        for (const [key, childValue] of Object.entries(node as Record<string, unknown>)) {
          visit(childValue, [...path, key], depth + 1)
        }
      }
    }
    visit(value, [], 0)
    return collapsed
  }

  private static getAt(root: unknown, path: readonly JsonPathSegment[]): unknown {
    let current = root
    for (const segment of path) {
      if (typeof segment === 'number' && Array.isArray(current)) {
        current = current[segment]
      } else if (
        typeof segment === 'string' &&
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(current)
      ) {
        current = (current as Record<string, unknown>)[segment]
      } else {
        return undefined
      }
    }
    return current
  }

  private static clone<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }
}
