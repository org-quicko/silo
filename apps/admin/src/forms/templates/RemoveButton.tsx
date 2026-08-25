import { Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './ArrayActionButton.module.css'

export function RemoveButton({ className, disabled, onClick }: any) {
  return (
    <Button
      variant="dangerGhost"
      size="sm"
      className={`${styles.action} ${className || ''}`}
      disabled={disabled}
      onClick={onClick}
      title="Remove"
      type="button"
    >
      <Trash2 size={14} />
    </Button>
  )
}
