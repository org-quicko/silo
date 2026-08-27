import { Toggle } from '../../components/controls/Toggle'
import styles from './CheckboxWidget.module.css'

export function CheckboxWidget(props: any) {
  const { value, disabled, readonly, onChange, label } = props
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label || 'Enabled'}</span>
      <Toggle on={!!value} onChange={(v) => !disabled && !readonly && onChange(v)} />
    </div>
  )
}
