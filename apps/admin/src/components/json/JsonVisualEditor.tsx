import { useCallback, useState, type CSSProperties } from 'react'
import {
  Ban,
  Braces,
  Brackets,
  ChevronsDownUp,
  ChevronsUpDown,
  Hash,
  Plus,
  RotateCcw,
  ToggleLeft,
  Type,
} from 'lucide-react'
import { JsonPrimitiveInput } from './JsonPrimitiveInput'
import { JsonTreeNode } from './JsonTreeNode'
import { JsonTypeBadge } from './JsonTypeBadge'
import { JsonSyntax } from './json-syntax'
import { JsonValue, type JsonConcreteType, type JsonPathSegment } from './json-value'
import styles from './JsonVisualEditor.module.css'

export interface JsonVisualEditorProps {
  value: unknown
  disabled?: boolean
  preferObject?: boolean
  maxHeight?: string
  onChange: (nextValue: unknown) => void
}

const STARTER_TYPES: readonly {
  type: JsonConcreteType
  label: string
  hint: string
  icon: typeof Braces
}[] = [
  { type: 'object', label: 'Object', hint: '{ key: value }', icon: Braces },
  { type: 'array', label: 'Array', hint: '[ items ]', icon: Brackets },
  { type: 'string', label: 'String', hint: '"text"', icon: Type },
  { type: 'number', label: 'Number', hint: '0, 42, 3.14', icon: Hash },
  { type: 'boolean', label: 'Boolean', hint: 'true / false', icon: ToggleLeft },
  { type: 'null', label: 'Null', hint: 'null', icon: Ban },
]

function readAt(root: unknown, path: readonly JsonPathSegment[]): unknown {
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

/**
 * Interactive tree/value builder for any JSON value (`object`, `array`,
 * `string`, `number`, `boolean`, `null`, or unset).
 */
export function JsonVisualEditor({
  value,
  disabled = false,
  preferObject = false,
  maxHeight,
  onChange,
}: JsonVisualEditorProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    JsonValue.defaultCollapsedPaths(value, 2),
  )
  const [autoFocusPath, setAutoFocusPath] = useState<string | null>(null)

  const handleToggleCollapse = useCallback((pathKey: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  }, [])

  const handleClearAutoFocus = useCallback(() => {
    setAutoFocusPath(null)
  }, [])

  const expandContainer = (containerPath: readonly JsonPathSegment[]) => {
    if (containerPath.length === 0) return
    const key = JsonValue.pathKey(containerPath)
    setCollapsed((previous) => {
      if (!previous.has(key)) return previous
      const next = new Set(previous)
      next.delete(key)
      return next
    })
  }

  const handleChangeValue = (path: readonly JsonPathSegment[], nextValue: unknown) => {
    onChange(JsonValue.setAt(value, path, nextValue))
  }

  const handleChangeType = (path: readonly JsonPathSegment[], nextType: JsonConcreteType) => {
    const current = readAt(value, path)
    onChange(JsonValue.setAt(value, path, JsonValue.coerce(current, nextType)))
  }

  const handleRenameKey = (
    parentPath: readonly JsonPathSegment[],
    oldKey: string,
    newKey: string,
  ) => {
    const result = JsonValue.renameKeyAt(value, parentPath, oldKey, newKey)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    if (oldKey !== newKey) {
      const oldPrefix = JsonValue.pathKey([...parentPath, oldKey]).slice(0, -1)
      const newPrefix = JsonValue.pathKey([...parentPath, newKey]).slice(0, -1)
      setCollapsed((previous) => {
        let changed = false
        const next = new Set<string>()
        for (const key of previous) {
          if (key === `${oldPrefix}]`) {
            next.add(`${newPrefix}]`)
            changed = true
          } else if (key.startsWith(`${oldPrefix},`)) {
            next.add(`${newPrefix}${key.slice(oldPrefix.length)}`)
            changed = true
          } else {
            next.add(key)
          }
        }
        return changed ? next : previous
      })
    }
    onChange(result.value)
    return { ok: true }
  }

  const handleAddProperty = (objectPath: readonly JsonPathSegment[]) => {
    const result = JsonValue.addObjectProperty(value, objectPath)
    expandContainer(objectPath)
    setAutoFocusPath(JsonValue.pathKey([...objectPath, result.key]))
    onChange(result.value)
  }

  const handleAddItem = (arrayPath: readonly JsonPathSegment[]) => {
    const result = JsonValue.addArrayItem(value, arrayPath, '')
    expandContainer(arrayPath)
    if (result.index >= 0) {
      setAutoFocusPath(JsonValue.pathKey([...arrayPath, result.index]))
    }
    onChange(result.value)
  }

  const handleMoveItem = (
    arrayPath: readonly JsonPathSegment[],
    fromIndex: number,
    toIndex: number,
  ) => {
    onChange(JsonValue.moveArrayItem(value, arrayPath, fromIndex, toIndex))
  }

  const handleDuplicate = (path: readonly JsonPathSegment[]) => {
    onChange(JsonValue.duplicateAt(value, path))
  }

  const handleRemove = (path: readonly JsonPathSegment[]) => {
    onChange(JsonValue.removeAt(value, path))
  }

  if (value === undefined) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyTitle}>
          {disabled
            ? 'No value set.'
            : preferObject
              ? 'No object value yet — choose a starting type:'
              : 'No value set — start with any JSON type:'}
        </div>
        {!disabled && (
          <div className={styles.starterGrid}>
            {STARTER_TYPES.map((starter) => {
              const Icon = starter.icon
              const emphasized = preferObject && starter.type === 'object'
              return (
                <button
                  key={starter.type}
                  type="button"
                  className={`${styles.starterCard} ${emphasized ? styles.starterPreferred : ''}`}
                  onClick={() => onChange(JsonValue.defaultFor(starter.type))}
                >
                  <span className={styles.starterTop}>
                    <Icon size={14} />
                    <span className={styles.starterLabel}>{starter.label}</span>
                  </span>
                  <span className={styles.starterHint}>{starter.hint}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const rootType = JsonValue.typeOf(value)
  const concreteRootType: JsonConcreteType = rootType === 'empty' ? 'null' : rootType
  const containerPaths = JsonValue.collectContainerPaths(value)
  const anyCollapsed = containerPaths.some((path) => collapsed.has(path))

  const toggleAllContainers = () => {
    if (anyCollapsed) {
      setCollapsed(new Set())
    } else {
      setCollapsed(new Set(containerPaths))
    }
  }

  const bodyStyle = maxHeight ? ({ maxHeight } as CSSProperties) : undefined

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <div className={styles.barLeft}>
          <JsonTypeBadge
            type={concreteRootType}
            disabled={disabled}
            ariaLabel="Root value type"
            onChange={(nextType) => onChange(JsonValue.coerce(value, nextType))}
          />
          <span className={styles.summary}>{JsonSyntax.summarize(value)}</span>
        </div>

        <div className={styles.barRight}>
          {containerPaths.length > 0 && (
            <button
              type="button"
              className={styles.barAction}
              onClick={toggleAllContainers}
            >
              {anyCollapsed ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
              <span>{anyCollapsed ? 'Expand all' : 'Collapse all'}</span>
            </button>
          )}
          {!disabled && (
            <button
              type="button"
              className={styles.barAction}
              title="Clear value (set to empty)"
              onClick={() => onChange(undefined)}
            >
              <RotateCcw size={12} />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      <div className={styles.body} style={bodyStyle}>
        {concreteRootType === 'object' ? (
          <div className={styles.treeList}>
            {Object.entries((value ?? {}) as Record<string, unknown>).length === 0 ? (
              <div className={styles.emptyContainer}>Empty object — add a property below.</div>
            ) : (
              Object.entries((value ?? {}) as Record<string, unknown>).map(
                ([childKey, childValue], _, entries) => (
                  <JsonTreeNode
                    key={childKey}
                    entryKey={childKey}
                    isArrayItem={false}
                    siblingCount={entries.length}
                    value={childValue}
                    path={[childKey]}
                    depth={0}
                    collapsed={collapsed}
                    autoFocusPath={autoFocusPath}
                    disabled={disabled}
                    onToggleCollapse={handleToggleCollapse}
                    onChangeValue={handleChangeValue}
                    onChangeType={handleChangeType}
                    onRenameKey={handleRenameKey}
                    onAddProperty={handleAddProperty}
                    onAddItem={handleAddItem}
                    onMoveItem={handleMoveItem}
                    onDuplicate={handleDuplicate}
                    onRemove={handleRemove}
                    onClearAutoFocus={handleClearAutoFocus}
                  />
                ),
              )
            )}
            {!disabled && (
              <button
                type="button"
                className={styles.rootAdd}
                onClick={() => handleAddProperty([])}
              >
                <Plus size={13} /> Add property
              </button>
            )}
          </div>
        ) : concreteRootType === 'array' ? (
          <div className={styles.treeList}>
            {(Array.isArray(value) ? value : []).length === 0 ? (
              <div className={styles.emptyContainer}>Empty array — add an item below.</div>
            ) : (
              (Array.isArray(value) ? value : []).map((item, index, list) => (
                <JsonTreeNode
                  key={index}
                  entryKey={index}
                  isArrayItem
                  siblingCount={list.length}
                  value={item}
                  path={[index]}
                  depth={0}
                  collapsed={collapsed}
                  autoFocusPath={autoFocusPath}
                  disabled={disabled}
                  onToggleCollapse={handleToggleCollapse}
                  onChangeValue={handleChangeValue}
                  onChangeType={handleChangeType}
                  onRenameKey={handleRenameKey}
                  onAddProperty={handleAddProperty}
                  onAddItem={handleAddItem}
                  onMoveItem={handleMoveItem}
                  onDuplicate={handleDuplicate}
                  onRemove={handleRemove}
                  onClearAutoFocus={handleClearAutoFocus}
                />
              ))
            )}
            {!disabled && (
              <button
                type="button"
                className={styles.rootAdd}
                onClick={() => handleAddItem([])}
              >
                <Plus size={13} /> Add item
              </button>
            )}
          </div>
        ) : (
          <div className={styles.scalarPane}>
            <JsonPrimitiveInput
              value={value as string | number | boolean | null}
              disabled={disabled}
              multilineByDefault={concreteRootType === 'string'}
              onChange={(nextScalar) => onChange(nextScalar)}
            />
            {concreteRootType === 'null' && (
              <span className={styles.nullHint}>Explicit JSON null — click Clear to unset.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
