import { ArrowDown } from 'lucide-react'
import { Button } from '../../components/Button'
import styles from './ArrayActionButton.module.css'

export function MoveDownButton({ className, disabled, onClick }: any) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={`${styles.action} ${className || ''}`}
      disabled={disabled}
      onClick={onClick}
      title="Move down"
      type="button"
    >
      <ArrowDown size={14} />
    </Button>
  )
}
