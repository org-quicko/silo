import { useCallback, useMemo, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { ArrayItemsContext } from './ArrayItemsContext'
import styles from './ArrayFieldTemplate.module.css'

// Slate array wrapper: stacks items and anchors the add action at the bottom.
// It also owns what the items can't do for themselves — publishing the live
// array so each item can title itself, and driving expand/collapse-all.
export function ArrayFieldTemplate(props: any) {
  const { canAdd, disabled, fieldPathId, formData, items, onAddClick, readonly, registry, required, schema, title, uiSchema } = props
  const ArrayFieldTitleTemplate = registry.templates.ArrayFieldTitleTemplate
  const ArrayFieldDescriptionTemplate = registry.templates.ArrayFieldDescriptionTemplate
  const { AddButton } = registry.templates.ButtonTemplates

  // Items report their own open state so the header can name the action that
  // would actually change something, rather than guessing from the last click.
  const [openState, setOpenState] = useState<Record<string, boolean>>({})
  const [command, setCommand] = useState<{ open: boolean; nonce: number } | null>(null)
  const report = useCallback((key: string, open: boolean | null) => {
    setOpenState((prev) => {
      if (open === null) {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return prev[key] === open ? prev : { ...prev, [key]: open }
    })
  }, [])
  const collapsible = Object.keys(openState)
  const allOpen = collapsible.length > 0 && collapsible.every((k) => openState[k])
  const context = useMemo(
    () => ({ data: Array.isArray(formData) ? formData : null, command, report }),
    [formData, command, report],
  )

  return (
    <fieldset className={styles.fieldset} id={fieldPathId.$id}>
      <div className={styles.head}>
        <ArrayFieldTitleTemplate fieldPathId={fieldPathId} title={title} required={required} schema={schema} uiSchema={uiSchema} registry={registry} />
        {collapsible.length > 1 && (
          <button
            type="button"
            className={styles.toggleAll}
            onClick={() => setCommand((prev) => ({ open: !allOpen, nonce: (prev?.nonce ?? 0) + 1 }))}
          >
            {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <ArrayFieldDescriptionTemplate fieldPathId={fieldPathId} description={schema.description} schema={schema} uiSchema={uiSchema} registry={registry} />
      <ArrayItemsContext.Provider value={context}>
        <div className={styles.list}>{items}</div>
      </ArrayItemsContext.Provider>
      {canAdd && (
        <AddButton
          id={`${fieldPathId.$id}__add`}
          className={styles.add}
          onClick={onAddClick}
          disabled={disabled || readonly}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
    </fieldset>
  )
}
