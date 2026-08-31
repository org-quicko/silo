import { Info } from 'lucide-react'
import type { MediaPolicyView } from '../../../api/types/media-settings'
import styles from './MediaStoragePage.module.css'

/**
 * What a library field is worth beside the box you type it in (D46).
 *
 * `MediaStorageNote`'s counterpart. Nothing at all when the file decides the
 * field, and what the server is using instead when it does not, because
 * `SILO_MEDIA_*` outranks the file and a page that hid that would let somebody
 * save a base URL the instance then ignores.
 */
export function MediaPolicyNote({
  view,
  field,
}: {
  view: MediaPolicyView
  field: 'base_url' | 'base_url_target' | 'extensions'
}) {
  const override = view.overrides.find((each) => each.field === field)
  if (!override) return null

  const inForce = view.in_force[field]
  const value = Array.isArray(inForce)
    ? `${inForce.length} type${inForce.length === 1 ? '' : 's'}`
    : inForce || 'the address each request arrives on'

  return (
    <span className={styles.note}>
      <Info size={12} />
      <span>
        In use: {value}
        {override.env ? ` (from ${override.env})` : ''}
      </span>
    </span>
  )
}
