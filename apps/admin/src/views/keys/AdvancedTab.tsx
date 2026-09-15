import { Plus } from 'lucide-react'
import type { Claim } from '@silo/shared/claim'
import { Button } from '../../components/buttons/Button'
import { AdvancedRowCard } from './AdvancedRowCard'
import { InstanceCapabilities } from './InstanceCapabilities'
import type { AdvancedPlan, AdvancedRow } from './key-plan'
import { KeyScopes } from './key-scope'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  plan: AdvancedPlan
  catalog: ScopeCatalog
  ownClaims: string[]
  onChange: (plan: AdvancedPlan) => void
}

/**
 * Every leaf claim, as a control.
 *
 * Two halves, because the claim grammar has two: collection permissions, which
 * are scoped and so come one block per scope, and the instance capabilities,
 * which are not scoped by anything and so are a flat list. Keeping the second
 * out of the scope blocks is not cosmetic — media, keys and transfer are
 * instance-global, and showing them inside a `acme / prod` block would say they
 * were confined to it.
 */
export function AdvancedTab({ plan, catalog, ownClaims, onChange }: Props) {
  const addRow = () => {
    const last = plan.rows[plan.rows.length - 1]
    const row: AdvancedRow = {
      scope: { project: last?.scope.project ?? catalog.projects[0] ?? KeyScopes.Any, env: KeyScopes.Any },
      collections: [],
      narrowed: false,
      permissions: [],
    }
    onChange({ ...plan, rows: [...plan.rows, row] })
  }

  const replaceRow = (index: number, row: AdvancedRow) =>
    onChange({ ...plan, rows: plan.rows.map((held, position) => (position === index ? row : held)) })

  return (
    <>
      <div className={styles.block}>
        <h3>Collections</h3>
        <p>One block per scope. A key can hold different permissions in each.</p>

        {plan.rows.length === 0 ? (
          <p className={styles.wildNote}>No collection permissions. Add a scope to grant some.</p>
        ) : (
          plan.rows.map((row, index) => (
            <AdvancedRowCard
              key={index}
              row={row}
              catalog={catalog}
              ownClaims={ownClaims}
              onChange={(next) => replaceRow(index, next)}
              onRemove={() =>
                onChange({ ...plan, rows: plan.rows.filter((_, position) => position !== index) })
              }
            />
          ))
        )}

        <Button variant="secondary" size="sm" onClick={addRow}>
          <Plus size={13} /> Add scope
        </Button>
      </div>

      <div className={styles.block}>
        <h3>Instance capabilities</h3>
        <p>These belong to the whole instance. No scope narrows them.</p>
        <InstanceCapabilities
          capabilities={plan.fixed}
          transferReplace={plan.transferReplace}
          ownClaims={ownClaims}
          onToggle={(claim: Claim) =>
            onChange({
              ...plan,
              fixed: plan.fixed.includes(claim)
                ? plan.fixed.filter((held) => held !== claim)
                : [...plan.fixed, claim],
            })
          }
          onTransferReplace={(transferReplace) => onChange({ ...plan, transferReplace })}
        />
      </div>
    </>
  )
}
