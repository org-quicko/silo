import type { MediaStorageView } from '../../../api/types/media-storage'
import { FactList } from '../parts/FactList'
import { SettingsSection } from '../parts/SettingsSection'

/**
 * What this server is using right now, as opposed to what the form holds.
 *
 * Deliberately read-only below the editable sections, the way Connection puts
 * the live instance below the endpoint you can change: the form is a proposal
 * until it is saved, and on an instance configured through the environment it
 * may never be the whole answer.
 */
export function MediaStorageInForce({ view }: { view: MediaStorageView }) {
  const facts = view.in_force
  const location = facts.driver === 'fs' ? facts.path : facts.bucket

  return (
    <SettingsSection title="In use right now" hint="After config file, environment and flags" divider={false}>
      <FactList
        facts={[
          { key: 'Provider', value: facts.driver, plain: true },
          {
            key: facts.driver === 'fs' ? 'Directory' : 'Bucket',
            value: location || '—',
          },
          {
            key: 'Credentials',
            value: facts.access_key_id
              ? `${facts.access_key_id}${facts.secret_access_key_set ? '' : ' (no secret)'}`
              : facts.secret_access_key_set
                ? 'secret only'
                : 'none',
            plain: !facts.access_key_id,
          },
          { key: 'Endpoint', value: facts.endpoint || 'provider default', plain: !facts.endpoint },
          {
            key: 'Addressing',
            value: facts.force_path_style ? 'path style' : 'virtual hosted',
            plain: true,
          },
          { key: 'Config file', value: view.config_path || 'none', plain: !view.config_path },
        ]}
      />
    </SettingsSection>
  )
}
