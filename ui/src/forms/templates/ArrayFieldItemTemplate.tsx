import { getTemplate } from '@rjsf/utils'
import styles from './ArrayFieldItemTemplate.module.css'

// Slate array item: card layout with the form content on the left and item
// actions (move/copy/remove) on the right.
export function ArrayFieldItemTemplate(props: any) {
  const { children, className, hasToolbar, registry, uiSchema } = props
  const uiOptions = registry.getUiOptions?.(uiSchema) || {}
  const ArrayFieldItemButtonsTemplate = getTemplate('ArrayFieldItemButtonsTemplate', registry, uiOptions)
  return (
    <div className={`${styles.item} ${className || ''}`}>
      <div className={styles.content}>{children}</div>
      {hasToolbar && (
        <div className={styles.toolbar}>
          <ArrayFieldItemButtonsTemplate {...props.buttonsProps} />
        </div>
      )}
    </div>
  )
}
