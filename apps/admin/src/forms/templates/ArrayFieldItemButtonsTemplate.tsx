import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './ArrayFieldItemButtonsTemplate.module.css'

// Slate array item actions: move, copy, and remove rendered with the shared
// Button component instead of Bootstrap glyphicons.
export function ArrayFieldItemButtonsTemplate(props: any) {
  const { disabled, hasCopy, hasMoveDown, hasMoveUp, hasRemove, onCopyItem, onRemoveItem, onMoveUpItem, onMoveDownItem, readonly } = props
  return (
    <>
      {(hasMoveUp || hasMoveDown) && (
        <>
          <Button
            variant="secondary"
            size="sm"
            className={styles.action}
            disabled={disabled || readonly || !hasMoveUp}
            onClick={onMoveUpItem}
            title="Move up"
            type="button"
          >
            <ArrowUp size={14} />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={styles.action}
            disabled={disabled || readonly || !hasMoveDown}
            onClick={onMoveDownItem}
            title="Move down"
            type="button"
          >
            <ArrowDown size={14} />
          </Button>
        </>
      )}
      {hasCopy && (
        <Button
          variant="secondary"
          size="sm"
          className={styles.action}
          disabled={disabled || readonly}
            onClick={onCopyItem}
          title="Copy"
          type="button"
        >
          <Copy size={14} />
        </Button>
      )}
      {hasRemove && (
        <Button
          variant="dangerGhost"
          size="sm"
          className={styles.action}
          disabled={disabled || readonly}
            onClick={onRemoveItem}
          title="Remove"
          type="button"
        >
          <Trash2 size={14} />
        </Button>
      )}
    </>
  )
}
