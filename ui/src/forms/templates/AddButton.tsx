import { Plus } from 'lucide-react'
import { Button } from '../../components/Button'
import styles from './ArrayActionButton.module.css'

export function AddButton({ id, className, onClick, disabled }: any) {
  return (
    <Button
      id={id}
      variant="dashed"
      className={`${styles.fullWidth} ${className || ''}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Plus size={14} /> Add item
    </Button>
  )
}
