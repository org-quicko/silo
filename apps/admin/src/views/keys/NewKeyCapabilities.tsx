import { AlertTriangle } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import { NewKeyPlan } from './new-key-plan'
import styles from './NewKey.module.css'

interface Capability {
  claim: Claim
  label: string
  help: string
  warn?: boolean
}

interface CapabilityGroup {
  title: string
  note?: string
  capabilities: Capability[]
}

const GROUPS: CapabilityGroup[] = [
  {
    title: 'Media',
    note: 'Media is instance-global — these are not scoped by the reach above.',
    capabilities: [
      { claim: Claims.MediaRead, label: 'List', help: 'List media metadata.' },
      { claim: Claims.MediaCreate, label: 'Upload', help: 'Upload new media files.' },
      { claim: Claims.MediaDelete, label: 'Delete', help: 'Delete media files.', warn: true },
    ],
  },
  {
    title: 'API keys',
    capabilities: [
      { claim: Claims.KeysRead, label: 'List', help: 'List key labels, prefixes and claims.' },
      { claim: Claims.KeysCreate, label: 'Mint', help: 'Mint keys, never exceeding this key’s own claims.' },
      { claim: Claims.KeysRevoke, label: 'Revoke', help: 'Revoke keys, never ones this key could not have minted.', warn: true },
      { claim: Claims.KeysExport, label: 'Export hashes', help: 'Include key hashes in an archive.', warn: true },
      { claim: Claims.KeysImport, label: 'Import hashes', help: 'Load key hashes from an archive, root keys included.', warn: true },
    ],
  },
  {
    title: 'Data transfer',
    note: 'An archive spans every project and environment, so each of these carries instance-wide collection permissions with it (D21).',
    capabilities: [
      { claim: Claims.TransferExport, label: 'Export', help: 'Download the whole instance as an archive.' },
      { claim: Claims.TransferImport, label: 'Import', help: 'Load an archive into this instance.', warn: true },
      { claim: Claims.TransferCopy, label: 'Server copy', help: 'Pull another running silo and import it.', warn: true },
    ],
  },
  {
    title: 'Plugins',
    note: 'A plugin runs code, so approving one hands it an authority set — and a key can only approve what it holds itself.',
    capabilities: [
      { claim: Claims.PluginsRead, label: 'List', help: 'List plugins, what each requested, and what was granted.' },
      { claim: Claims.PluginsConfigure, label: 'Configure', help: 'Change plugin settings.' },
      { claim: Claims.PluginsGrant, label: 'Approve', help: 'Grant and revoke what a plugin may do.', warn: true },
      { claim: Claims.PluginsEnable, label: 'Enable', help: 'Turn plugins on and off. Takes effect at the next restart.', warn: true },
    ],
  },
  {
    title: 'Audit',
    note: 'The trail of authority changes: keys minted and revoked, plugins granted, revoked, enabled and disabled.',
    capabilities: [
      { claim: Claims.AuditRead, label: 'Read', help: 'Read the authority trail. It names every key and claim ever granted here.' },
    ],
  },
]

/**
 * The claims that belong to the instance rather than to a scope.
 *
 * The transfer group is the reason this panel does more than toggle strings:
 * a `transfer:*` claim on its own authorizes nothing, so the panel shows and
 * adds the instance-wide collection permissions the route will also demand
 * (`NewKeyPlan.transferRequirements`), and refuses the toggle outright when
 * the minting key cannot delegate them.
 */
export function NewKeyCapabilities({
  capabilities,
  transferReplace,
  ownClaims,
  onToggle,
  onTransferReplace,
}: {
  capabilities: Claim[]
  transferReplace: boolean
  ownClaims: string[]
  onToggle: (claim: Claim) => void
  onTransferReplace: (value: boolean) => void
}) {
  const transferChosen = capabilities.some((claim) =>
    claim === Claims.TransferExport || claim === Claims.TransferImport || claim === Claims.TransferCopy,
  )
  const writeChosen = capabilities.includes(Claims.TransferImport) || capabilities.includes(Claims.TransferCopy)

  /** A transfer toggle is only offered when its implied instance-wide grant is delegatable too. */
  const blockedReason = (claim: Claim): string => {
    if (!Claims.has(ownClaims, claim)) return 'The current key does not hold this claim.'
    const implied = NewKeyPlan.transferRequirements([claim], transferReplace)
    if (implied.length > 0 && !Claims.canDelegate(ownClaims, implied)) {
      return 'The current key cannot delegate the instance-wide collection permissions this claim requires.'
    }
    return ''
  }

  const required = NewKeyPlan.transferRequirements(capabilities, transferReplace)

  return (
    <div className={styles.capabilities}>
      {GROUPS.map((group) => (
        <div className={styles.capabilityGroup} key={group.title}>
          <div className={styles.capabilityHead}>
            <b>{group.title}</b>
            {group.note && <span>{group.note}</span>}
          </div>
          <div className={styles.capabilityOptions}>
            {group.capabilities.map((capability) => {
              const blocked = blockedReason(capability.claim)
              const checked = capabilities.includes(capability.claim)
              return (
                <label
                  key={capability.claim}
                  className={`${styles.capability} ${capability.warn ? styles.capabilityWarn : ''} ${blocked ? styles.capabilityBlocked : ''}`}
                  title={blocked || capability.help}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!!blocked}
                    onChange={() => onToggle(capability.claim)}
                  />
                  <span>
                    <b>{capability.label}</b>
                    <small>{capability.claim}</small>
                  </span>
                </label>
              )
            })}
          </div>

          {group.title === 'Data transfer' && transferChosen && (
            <div className={styles.transferImplied}>
              {writeChosen && (
                <label className={styles.replaceToggle}>
                  <input
                    type="checkbox"
                    checked={transferReplace}
                    onChange={(event) => onTransferReplace(event.target.checked)}
                  />
                  <span>
                    <b>Allow <code>mode=replace</code></b>
                    <small>Adds instance-wide delete authority. Without it the key can merge but not replace.</small>
                  </span>
                </label>
              )}
              <div className={styles.impliedNote}>
                <AlertTriangle size={13} />
                <span>Also grants, across every project and environment:</span>
              </div>
              <div className={styles.codeList}>
                {required.map((claim) => <code key={claim}>{claim}</code>)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
