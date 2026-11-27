import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Plus,
  Trash2,
} from 'lucide-react'
import { JsonPrimitiveInput } from './JsonPrimitiveInput'
import { JsonTypeBadge } from './JsonTypeBadge'
import { JsonSyntax } from './json-syntax'
import { JsonValue, type JsonConcreteType, type JsonPathSegment } from './json-value'
import styles from './JsonTreeNode.module.css'

export interface JsonTreeNodeProps {
  entryKey: string | number
  isArrayItem: boolean
  siblingCount: number
  value: unknown
  path: readonly JsonPathSegment[]
  depth: number
  collapsed: ReadonlySet<string>
  autoFocusPath: string | null
  disabled?: boolean
  onToggleCollapse: (pathKey: string) => void
  onChangeValue: (path: readonly JsonPathSegment[], nextValue: unknown) => void
  onChangeType: (path: readonly JsonPathSegment[], nextType: JsonConcreteType) => void
  onRenameKey: (
    parentPath: readonly JsonPathSegment[],
    oldKey: string,
    newKey: string,
  ) => { ok: boolean; error?: string }
  onAddProperty: (objectPath: readonly JsonPathSegment[]) => void
  onAddItem: (arrayPath: readonly JsonPathSegment[]) => void
  onMoveItem: (arrayPath: readonly JsonPathSegment[], fromIndex: number, toIndex: number) => void
  onDuplicate: (path: readonly JsonPathSegment[]) => void
  onRemove: (path: readonly JsonPathSegment[]) => void
  onClearAutoFocus: () => void
}

/**
 * Recursive node in `JsonVisualEditor` representing one object property or
 * array item, with inline key editing, type conversion, collapse/expand,
 * reorder/duplicate/delete actions, and nested child rails.
 */
export function JsonTreeNode({
  entryKey,
  isArrayItem,
  siblingCount,
  value,
  path,
  depth,
  collapsed,
  autoFocusPath,
  disabled = false,
  onToggleCollapse,
  onChangeValue,
  onChangeType,
  onRenameKey,
  onAddProperty,
  onAddItem,
  onMoveItem,
  onDuplicate,
  onRemove,
  onClearAutoFocus,
}: JsonTreeNodeProps) {
  const pathKey = JsonValue.pathKey(path)
  const parentPath = path.slice(0, -1)
  const keyText = String(entryKey)
  const [prevSyncedKey, setPrevSyncedKey] = useState(keyText)
  const [keyDraft, setKeyDraft] = useState(keyText)
  const [keyError, setKeyError] = useState('')
  const keyInputRef = useRef<HTMLInputElement | null>(null)

  if (keyText !== prevSyncedKey) {
    setPrevSyncedKey(keyText)
    setKeyDraft(keyText)
    setKeyError('')
  }

  const shouldAutoFocus = autoFocusPath === pathKey

  useEffect(() => {
    if (!shouldAutoFocus || disabled) return
    if (!isArrayItem && keyInputRef.current) {
      keyInputRef.current.focus()
      keyInputRef.current.select()
    }
    onClearAutoFocus()
  }, [shouldAutoFocus, disabled, isArrayItem, onClearAutoFocus])

  const valueType = JsonValue.typeOf(value)
  const concreteType: JsonConcreteType = valueType === 'empty' ? 'null' : valueType
  const isContainer = concreteType === 'object' || concreteType === 'array'
  const isCollapsed = isContainer && collapsed.has(pathKey)

  const commitKey = () => {
    if (isArrayItem || disabled) return
    if (keyDraft === keyText) {
      setKeyError('')
      return
    }
    const result = onRenameKey(parentPath, keyText, keyDraft)
    if (result.ok) {
      setKeyError('')
    } else {
      setKeyError(result.error || 'Duplicate key')
    }
  }

  const renderContainerChildren = () => {
    if (concreteType === 'object') {
      const record = (value ?? {}) as Record<string, unknown>
      const entries = Object.entries(record)
      return (
        <div
          className={styles.children}
          style={{ '--depth': Math.min(depth + 1, 4) } as CSSProperties}
        >
          {entries.length === 0 ? (
            <div className={styles.emptyBranch}>Empty object</div>
          ) : (
            entries.map(([childKey, childValue]) => (
              <JsonTreeNode
                key={childKey}
                entryKey={childKey}
                isArrayItem={false}
                siblingCount={entries.length}
                value={childValue}
                path={[...path, childKey]}
                depth={depth + 1}
                collapsed={collapsed}
                autoFocusPath={autoFocusPath}
                disabled={disabled}
                onToggleCollapse={onToggleCollapse}
                onChangeValue={onChangeValue}
                onChangeType={onChangeType}
                onRenameKey={onRenameKey}
                onAddProperty={onAddProperty}
                onAddItem={onAddItem}
                onMoveItem={onMoveItem}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
                onClearAutoFocus={onClearAutoFocus}
              />
            ))
          )}
          {!disabled && (
            <button
              type="button"
              className={styles.branchAdd}
              onClick={() => onAddProperty(path)}
            >
              <Plus size={12} /> Add property
            </button>
          )}
        </div>
      )
    }

    const items = Array.isArray(value) ? value : []
    return (
      <div
        className={styles.children}
        style={{ '--depth': Math.min(depth + 1, 4) } as CSSProperties}
      >
        {items.length === 0 ? (
          <div className={styles.emptyBranch}>Empty array</div>
        ) : (
          items.map((item, index) => (
            <JsonTreeNode
              key={index}
              entryKey={index}
              isArrayItem
              siblingCount={items.length}
              value={item}
              path={[...path, index]}
              depth={depth + 1}
              collapsed={collapsed}
              autoFocusPath={autoFocusPath}
              disabled={disabled}
              onToggleCollapse={onToggleCollapse}
              onChangeValue={onChangeValue}
              onChangeType={onChangeType}
              onRenameKey={onRenameKey}
              onAddProperty={onAddProperty}
              onAddItem={onAddItem}
              onMoveItem={onMoveItem}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              onClearAutoFocus={onClearAutoFocus}
            />
          ))
        )}
        {!disabled && (
          <button
            type="button"
            className={styles.branchAdd}
            onClick={() => onAddItem(path)}
          >
            <Plus size={12} /> Add item
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.node}>
      <div className={styles.row}>
        <div className={styles.keySlot}>
          {isContainer ? (
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? `Expand ${keyText}` : `Collapse ${keyText}`}
              onClick={() => onToggleCollapse(pathKey)}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span className={styles.disclosureSpacer} aria-hidden="true" />
          )}

          {isArrayItem ? (
            <span className={styles.indexBadge}>[{entryKey}]</span>
          ) : (
            <div className={styles.keyInputWrap}>
              <input
                ref={keyInputRef}
                type="text"
                className={`${styles.keyInput} ${keyError ? styles.keyInputInvalid : ''}`}
                value={keyDraft}
                disabled={disabled}
                aria-label={`Property name ${keyText}`}
                aria-invalid={Boolean(keyError)}
                onChange={(event) => {
                  setKeyDraft(event.target.value)
                  if (keyError) setKeyError('')
                }}
                onBlur={commitKey}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitKey()
                  } else if (event.key === 'Escape') {
                    event.stopPropagation()
                    event.preventDefault()
                    setKeyDraft(keyText)
                    setKeyError('')
                    keyInputRef.current?.blur()
                  }
                }}
              />
              {keyError && <span className={styles.keyError}>{keyError}</span>}
            </div>
          )}
        </div>

        <div className={styles.valueSlot}>
          <JsonTypeBadge
            type={concreteType}
            disabled={disabled}
            ariaLabel={`Type for ${isArrayItem ? `item ${entryKey}` : keyText}`}
            onChange={(nextType) => onChangeType(path, nextType)}
          />

          {isContainer ? (
            <div className={styles.containerMeta}>
              <span className={styles.containerSummary}>{JsonSyntax.summarize(value)}</span>
              {!disabled && (
                <button
                  type="button"
                  className={styles.quickAdd}
                  onClick={() =>
                    concreteType === 'object' ? onAddProperty(path) : onAddItem(path)
                  }
                >
                  <Plus size={11} />
                  {concreteType === 'object' ? 'Key' : 'Item'}
                </button>
              )}
            </div>
          ) : (
            <JsonPrimitiveInput
              value={value as string | number | boolean | null}
              disabled={disabled}
              autoFocus={isArrayItem && shouldAutoFocus}
              onChange={(nextScalar) => onChangeValue(path, nextScalar)}
            />
          )}
        </div>

        {!disabled && (
          <div className={styles.actions}>
            {isArrayItem && typeof entryKey === 'number' && (
              <>
                <button
                  type="button"
                  className={styles.iconAction}
                  disabled={entryKey <= 0}
                  title="Move up"
                  aria-label={`Move item ${entryKey} up`}
                  onClick={() => onMoveItem(parentPath, entryKey, entryKey - 1)}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className={styles.iconAction}
                  disabled={entryKey >= siblingCount - 1}
                  title="Move down"
                  aria-label={`Move item ${entryKey} down`}
                  onClick={() => onMoveItem(parentPath, entryKey, entryKey + 1)}
                >
                  <ArrowDown size={12} />
                </button>
              </>
            )}
            <button
              type="button"
              className={styles.iconAction}
              title="Duplicate"
              aria-label={`Duplicate ${isArrayItem ? `item ${entryKey}` : keyText}`}
              onClick={() => onDuplicate(path)}
            >
              <CopyPlus size={12} />
            </button>
            <button
              type="button"
              className={`${styles.iconAction} ${styles.dangerAction}`}
              title="Remove"
              aria-label={`Remove ${isArrayItem ? `item ${entryKey}` : keyText}`}
              onClick={() => onRemove(path)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {isContainer && !isCollapsed && renderContainerChildren()}
    </div>
  )
}
