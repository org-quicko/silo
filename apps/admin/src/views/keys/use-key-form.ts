import { useEffect, useMemo, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import { KeyFormat } from '@silo/shared/key-format'
import { api } from '../../api/silo-api'
import type { CreatedKey } from '../../api/types/created-key'
import type { KeyView } from '../../api/types/key-view'
import type { ScopeRef } from '../../api/types/scope-ref'
import { KeyClaimFit } from './key-claim-fit'
import type { KeyMode } from './key-mode'
import { KeyPlan, type AdvancedPlan, type PresetPlan } from './key-plan'
import { KeyPlanReader } from './key-plan-reader'
import { KeyRoles } from './key-roles'
import { KeyScopes } from './key-scope'
import { useScopeCatalog } from './use-scope-catalog'

const EMPTY_ADVANCED: AdvancedPlan = { rows: [], fixed: [], transferReplace: false }

/**
 * The key form, in whichever of its three modes, for creating or for editing.
 *
 * One hook for both because they are one form: the only differences are where
 * the initial claim list comes from and which request the Save button makes.
 * Two hooks would mean the guided controls, the delegation probes and the
 * review were each written twice, and the second copy is the one that ends up
 * offering a claim the route refuses.
 *
 * The three modes are **modes over one claim list** (see `KeyMode`). Switching
 * tabs reads the current list back into the target mode through
 * `KeyPlanReader`, and refuses the switch outright when that would lose
 * something — never approximates it.
 */
export function useKeyForm(
  url: string,
  apiKey: string,
  ownClaims: string[],
  scope: ScopeRef | null,
  subject: KeyView | null,
  /** Called once the edit has been written. An edit has nothing to show
   *  afterwards — unlike a mint, which still has to hand over the secret — so
   *  the page leaves rather than rendering a success state nobody reads. */
  onSaved: () => void,
) {
  const initial = useMemo(
    () => (subject ? KeyClaimFit.of(subject.claims) : null),
    [subject?.id],
  )

  const [label, setLabel] = useState(subject?.label ?? '')
  const [mode, setMode] = useState<KeyMode>(initial?.mode ?? 'presets')
  const [modeError, setModeError] = useState('')

  const [preset, setPreset] = useState<PresetPlan>(
    initial?.preset ?? {
      role: 'read',
      scopes: [{ project: scope?.project ?? '', env: scope?.env ?? KeyScopes.Any }],
    },
  )
  const [advanced, setAdvanced] = useState<AdvancedPlan>(initial?.advanced ?? EMPTY_ADVANCED)
  const [customText, setCustomText] = useState(subject ? subject.claims.join('\n') : '')
  const [scopeTouched, setScopeTouched] = useState(!!subject)

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedKey | null>(null)

  const catalog = useScopeCatalog(url, apiKey)

  // The settings scope resolves over two round trips (projects, then that
  // project's environments), so it is still null on first paint and cannot be
  // read once into `useState`. It seeds a new key's first scope row the moment
  // it arrives, and stops mattering as soon as the user picks for themselves.
  useEffect(() => {
    if (scopeTouched || !scope) return
    setPreset((held) => ({ ...held, scopes: [{ project: scope.project, env: scope.env }] }))
  }, [scope?.project, scope?.env, scopeTouched])

  const custom = useMemo(() => {
    const tokens = customText.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean)
    try {
      return { claims: Claims.normalize(tokens), error: '' }
    } catch (caught: any) {
      return { claims: [] as Claim[], error: caught.message || 'Invalid claim' }
    }
  }, [customText])

  // Composition is a handful of string joins over a bounded permission list, so
  // it runs on every render rather than carrying a memo whose dependency list
  // would have to restate the whole form.
  const claims =
    mode === 'presets'
      ? KeyPlan.fromPreset(preset)
      : mode === 'advanced'
        ? KeyPlan.fromAdvanced(advanced)
        : custom.claims

  /** The scope the access pill is evaluated in: a single scope row names one,
   *  and anything wider is judged against the instance. */
  const pillScope =
    mode === 'presets' && preset.scopes.length === 1 ? preset.scopes[0] : null

  const switchMode = (next: KeyMode) => {
    if (next === mode) return
    setModeError('')

    if (next === 'custom') {
      setCustomText(claims.join('\n'))
      setMode('custom')
      return
    }

    if (next === 'presets') {
      const fitted = KeyPlanReader.preset(claims)
      if (!fitted) {
        setModeError(
          'These claims are not one standard role. Advanced or Custom can hold them.',
        )
        return
      }
      setPreset(fitted)
      setMode('presets')
      return
    }

    const fitted = KeyPlanReader.advanced(claims)
    if (!fitted) {
      const unnamed = KeyClaimFit.of(claims).unrepresentable
      setModeError(
        unnamed.length > 0
          ? `Advanced has no control for ${unnamed.join(', ')}. Custom can hold them.`
          : 'Advanced cannot hold these claims. Custom can.',
      )
      return
    }
    setAdvanced(fitted)
    setMode('advanced')
  }

  const blockedRoles: Partial<Record<ClaimPreset, string>> = {}
  for (const option of KeyRoles.All) {
    const probe = KeyPlan.fromPreset({ role: option.value, scopes: preset.scopes })
    if (probe.length > 0 && !Claims.canDelegate(ownClaims, probe)) {
      blockedRoles[option.value] = 'The current key cannot delegate this role here.'
    }
  }

  const changed =
    !subject ||
    label.trim() !== subject.label ||
    claims.length !== subject.claims.length ||
    claims.some((claim, index) => claim !== subject.claims[index])

  /** What saving an edit would add and take away, for the confirmation. */
  const diff = useMemo(() => {
    if (!subject) return { added: [] as string[], removed: [] as string[] }
    const before = new Set(subject.claims)
    const after = new Set<string>(claims)
    return {
      added: claims.filter((claim) => !before.has(claim)),
      removed: subject.claims.filter((claim) => !after.has(claim)),
    }
  }, [subject?.id, subject?.claims, claims])

  /** Every reason the form is not ready, in the order the user meets them. */
  const validate = (): string | null => {
    if (!label.trim()) return 'A label is required.'
    if (mode === 'custom' && custom.error) return custom.error

    if (mode === 'presets' && preset.role !== 'root') {
      const incomplete = preset.scopes.find((row) => !KeyScopes.complete(row))
      if (incomplete) return 'Choose a project and an environment for every scope.'
      const invalid = preset.scopes.find(
        (row) => !KeyScopes.isAny(row.env) && !Claims.isScopeId(row.env),
      )
      if (invalid) return `"${invalid.env}" is not a valid environment id.`
    }

    if (mode === 'advanced') {
      const incomplete = advanced.rows.find((row) => !KeyScopes.complete(row.scope))
      if (incomplete) return 'Choose a project and an environment for every scope.'
      const empty = advanced.rows.find((row) => row.narrowed && row.collections.length === 0)
      if (empty) return 'Select at least one collection, or widen a scope to all collections.'
    }

    if (claims.length === 0) return 'Select at least one claim.'
    if (!Claims.canDelegate(ownClaims, claims)) {
      return 'The current key cannot delegate one or more selected claims.'
    }
    if (subject && !changed) return 'Nothing has changed.'
    return null
  }

  return {
    label,
    setLabel,
    mode,
    modeError,
    switchMode,
    preset,
    setPreset,
    advanced,
    setAdvanced,
    customText,
    setCustomText,
    custom,
    catalog,

    claims,
    pillScope,
    describeScope: () => {
      if (claims.includes(Claims.Root)) return 'every project / every environment'
      if (mode === 'presets') return KeyPlan.describeScopes(preset.scopes)
      if (mode === 'advanced') return KeyPlan.describeScopes(advanced.rows.map((row) => row.scope))
      // Custom writes no scope rows, so the reach is read back out of the
      // claims themselves rather than reported as nothing.
      return KeyPlan.describeScopes(KeyPlan.scopesOf(claims))
    },
    canDelegate: Claims.canDelegate(ownClaims, claims),
    blockedRoles,
    changed,
    diff,
    /** Whether the key being edited is the one this session is connected with.
     *  Narrowing it takes effect on the next request, including this page's. */
    editingSelf: !!subject && subject.prefix === KeyFormat.displayPrefix(apiKey),

    error,
    setError,
    busy,
    created,

    setScopeTouched,

    submit: async () => {
      const problem = validate()
      if (problem) {
        setError(problem)
        return
      }

      setBusy(true)
      setError('')
      try {
        if (subject) {
          await api.keys.update(url, apiKey, subject.id, { label: label.trim(), claims })
          // In the handler, not in render: navigating while the view renders is
          // a state update on the router from inside another component.
          onSaved()
        } else {
          setCreated(await api.keys.create(url, apiKey, label.trim(), claims))
        }
      } catch (caught: any) {
        setError(caught.message || (subject ? 'Failed to save key' : 'Failed to create key'))
      } finally {
        setBusy(false)
      }
    },
  }
}
