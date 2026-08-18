import { AlertCircle } from 'lucide-react'
import styles from './ErrorListTemplate.module.css'

export function ErrorListTemplate(props: any) {
  const count = props.errors?.length || 0
  if (!count) return null
  return (
    <div className={`banner banner-bad ${styles.root}`}>
      <AlertCircle size={16} />
      <span>
        <b>
          {count} field{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} attention
        </b>{' '}
        before this entry can be saved. {count === 1 ? "It's" : "They're"} highlighted below.
      </span>
    </div>
  )
}
