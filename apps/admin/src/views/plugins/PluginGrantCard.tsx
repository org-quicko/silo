import { useMemo, useState } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { ClaimGroups } from '../../claims/claim-groups'
import type { PluginView } from '../../api/types/plugin-view'
import { PluginClaimCheck } from './PluginClaimCheck'
import { PluginGrantScope } from './PluginGrantScope'
import { PluginGrantPlan, type PluginGrantScope as GrantScope } from './plugin-grant-plan'
import styles from './PluginDetail.module.css'

/**
 * The grant: what the package asked for, what it holds, and the decision
 * between them (D34, phase 5).
 *
 * Two things make this more than a checkbox list. **Hook delivery is in it** —
 * a plugin handed `entry.beforeValidate` rewrites everything written to a
 * collection, which no `entries:*` permission grants, so it is shown as the
 * larger authority it is rather than as another line. And **the summary is
 * sentences**, because the reason to show a grant before approving it is that
 * someone can catch a mistake in it, and nobody proofreads forty monospace
 * strings.
 */
export function PluginGrantCard({
  plugin,
  url,
  apiKey,
  projects,
  ownClaims,
  canGrant,
  busy,
  onGrant,
  onRevoke,
}: {
  plugin: PluginView
  url: string
  apiKey: string
  projects: string[]
  ownClaims: string[]
  canGrant: boolean
  busy: boolean
  onGrant: (claims: string[]) => void
  onRevoke: () => void
}) {
  const rows = useMemo(() => PluginGrantPlan.rows(plugin, ownClaims), [plugin, ownClaims])
  const [chosen, setChosen] = useState<string[]>(() => PluginGrantPlan.initialSelection(plugin))
  const [scope, setScope] = useState<GrantScope>(() => PluginGrantPlan.initialScope(plugin))

  const claims = PluginGrantPlan.claims(chosen, scope)
  const groups = ClaimGroups.build(claims)
  const locked = !canGrant || busy

  const toggle = (claim: string, on: boolean) =>
    setChosen((current) =>
      on ? [...current, claim] : current.filter((held) => held !== claim),
    )

  const grantable = rows.filter((row) => !row.forbidden && row.delegable).map((row) => row.claim)
  const required = grantable.filter((claim) => plugin.required.includes(claim))

  // `held === 'none'` and not a set difference: a required claim answered by a
  // narrower grant has been *decided*, and calling that unmet would nag at
  // exactly the operator who was being careful. The three-valued answer D40
  // introduced is what makes the distinction available here at all.
  const unmet = rows.filter((row) => row.required && row.held === 'none')

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.sectionTitle}>
          <ShieldCheck size={16} />
          <h2>Permissions</h2>
        </div>
        <p>
          What <b>{plugin.name}</b> asked for, and what you allow. A grant takes effect on the next
          hook and the next call it makes — nothing restarts.
        </p>
      </div>

      {plugin.state === 'needs_review' && (
        <div className="banner banner-warn">
          <span>
            An upgrade asked for more than this plugin holds. It is still running on what it had;
            nothing was granted automatically.
          </span>
        </div>
      )}

      {unmet.length > 0 && (
        <div className="banner banner-warn">
          <span>
            <b>{plugin.name}</b> holds less than it says it needs:{' '}
            {unmet.map((claim) => claim.claim).join(', ')}. It is running, and whatever those
            permissions were for will not work. That is a normal thing to have chosen — this says so
            because a deliberate narrowing and an accidental one look identical otherwise.
          </span>
        </div>
      )}

      {plugin.config_claims.length > 0 && (
        <div className={styles.note}>
          <b>{plugin.config_claims.length} claim{plugin.config_claims.length === 1 ? '' : 's'} come
          from <code>silo.toml</code></b>
          <span>
            Effective authority is the file and this record together. Revoking here clears only what
            is stored — the file&apos;s claims survive it, and editing them is a file edit followed by
            a re-read.
          </span>
          <div className={styles.codeList}>
            {plugin.config_claims.map((claim: string) => <code key={claim}>{claim}</code>)}
          </div>
        </div>
      )}

      {plugin.requested.length === 0 ? (
        <p className={styles.empty}>This plugin asks for no permissions at all.</p>
      ) : (
        <>
          <div className={styles.claimList}>
            {rows.map((row) => (
              <PluginClaimCheck
                key={row.claim}
                row={row}
                checked={chosen.includes(row.claim)}
                disabled={locked}
                onChange={(on) => toggle(row.claim, on)}
              />
            ))}
          </div>

          <div className={styles.selectRow}>
            <Button variant="secondary" size="sm" disabled={locked} onClick={() => setChosen(grantable)}>
              Select all
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={locked}
              onClick={() => setChosen(required)}
              title="What the package says it cannot work without — and what the API grants when no claims are named"
            >
              Only what it requires
            </Button>
            <Button variant="secondary" size="sm" disabled={locked} onClick={() => setChosen([])}>
              Select none
            </Button>
          </div>

          <PluginGrantScope
            url={url}
            apiKey={apiKey}
            projects={projects}
            value={scope}
            disabled={locked}
            onChange={setScope}
          />

          <div className={styles.review}>
            <div className={styles.reviewHead}>
              <b>This plugin will be able to</b>
              <Pill tone={claims.length === 0 ? 'muted' : 'ok'}>
                {claims.length} claim{claims.length === 1 ? '' : 's'}
              </Pill>
            </div>
            {groups.length === 0 ? (
              <p className={styles.empty}>Nothing. It stays loaded and receives no events.</p>
            ) : (
              <div className={styles.groups}>
                {groups.map((group) => (
                  <div
                    key={group.title}
                    className={`${styles.group} ${group.warn ? styles.groupWarn : ''}`}
                  >
                    <b>{group.title}</b>
                    <span>{group.lines.join(' · ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {canGrant && (
        <div className={styles.cardActions}>
          {plugin.granted.length > 0 && (
            <Button variant="dangerGhost" disabled={busy} onClick={onRevoke}>
              <ShieldOff size={14} /> Revoke
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => onGrant(claims)}>
            Save grant
          </Button>
        </div>
      )}
    </section>
  )
}
