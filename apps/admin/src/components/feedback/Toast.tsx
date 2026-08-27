import { Check } from 'lucide-react'
import styles from './Toast.module.css'

export function Toast({ message }: { message: string }) {
  return (
    <div className={styles.toast}>
      <Check size={14} /> {message}
    </div>
  )
}
