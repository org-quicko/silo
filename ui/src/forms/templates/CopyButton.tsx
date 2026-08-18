import { Copy } from 'lucide-react'
import { Button } from '../../components/Button'
import styles from './ArrayActionButton.module.css'

export function CopyButton({ className, disabled, onClick }: any) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={`${styles.action} ${className || ''}`}
      disabled={disabled}
      onClick={onClick}
      title="Copy"
      type="button"
    >
      <Copy size={14} />
    </Button>
  )
}
