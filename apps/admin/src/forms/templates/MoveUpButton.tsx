import { ArrowUp } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './ArrayActionButton.module.css'

export function MoveUpButton({ className, disabled, onClick }: any) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={`${styles.action} ${className || ''}`}
      disabled={disabled}
      onClick={onClick}
      title="Move up"
      type="button"
    >
      <ArrowUp size={14} />
    </Button>
  )
}
