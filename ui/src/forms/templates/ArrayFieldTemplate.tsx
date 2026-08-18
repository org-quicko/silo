import styles from './ArrayFieldTemplate.module.css'

// Slate array wrapper: stacks items and anchors the add action at the bottom.
export function ArrayFieldTemplate(props: any) {
  const { canAdd, disabled, fieldPathId, items, onAddClick, readonly, registry, required, schema, title, uiSchema } = props
  const ArrayFieldTitleTemplate = registry.templates.ArrayFieldTitleTemplate
  const ArrayFieldDescriptionTemplate = registry.templates.ArrayFieldDescriptionTemplate
  const { AddButton } = registry.templates.ButtonTemplates
  return (
    <fieldset className={styles.fieldset} id={fieldPathId.$id}>
      <ArrayFieldTitleTemplate fieldPathId={fieldPathId} title={title} required={required} schema={schema} uiSchema={uiSchema} registry={registry} />
      <ArrayFieldDescriptionTemplate fieldPathId={fieldPathId} description={schema.description} schema={schema} uiSchema={uiSchema} registry={registry} />
      <div className={styles.list}>{items}</div>
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
