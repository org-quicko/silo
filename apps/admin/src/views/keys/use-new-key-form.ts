import { useEffect, useMemo, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import { api } from '../../api/silo-api'
import type { CreatedKey } from '../../api/types/created-key'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { KeyReach } from './key-reach'
import { KeyRoles } from './key-roles'
import { NewKeyPlan, type NewKeyPlanInput } from './new-key-plan'

/** A patch to the reach controls — reach, project and env move together. */
interface ReachPatch {
  reach?: KeyReach
  project?: string
  env?: string
}

/**
 * The whole create-key form: the guided sentence, the advanced toggles, and
 * the raw claim editor that takes over when neither is enough.
 *
 * Delegation shapes the controls rather than only the error at the bottom — an
 * option the current key could never grant is never offered — so the "can this
 * be delegated" probes live here beside the state they judge.
 */
export function useNewKeyForm(
  url: string,
  apiKey: string,
  ownClaims: string[],
  scope: ScopeRef | null,
) {
  const [label, setLabel] = useState('')
  const [reach, setReach] = useState<KeyReach>('env')
  const [project, setProject] = useState(scope?.project ?? '')
  const [env, setEnv] = useState(scope?.env ?? '')
  const [role, setRole] = useState<ClaimPreset>('read')
  const [narrowed, setNarrowed] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [capabilities, setCapabilities] = useState<Claim[]>(() => [
    ...Claims.presetFixedClaims('read'),
  ])
  const [transferReplace, setTransferReplace] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [scopeTouched, setScopeTouched] = useState(false)

  const [environments, setEnvironments] = useState<string[]>([])
  const [loadingEnvironments, setLoadingEnvironments] = useState(false)
  const [collections, setCollections] = useState<string[]>([])

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedKey | null>(null)

  // The settings scope resolves over two round trips (projects, then that
  // project's environments), so it is still null on first paint and cannot be
  // read once into `useState`. It seeds the reach the moment it arrives, and
  // stops mattering as soon as the user picks for themselves.
  useEffect(() => {
    if (scopeTouched || !scope) return
    setProject(scope.project)
    setEnv(scope.env)
  }, [scope?.project, scope?.env, scopeTouched])

  // The reach's project drives its own env list, which is not necessarily the
  // settings scope's — the whole point of the picker is that a key can be
  // minted for a project you are not currently working in.
  useEffect(() => {
    if (!project) {
      setEnvironments([])
      return
    }

    let alive = true
    setLoadingEnvironments(true)
    api.projects
      .listEnvironments(url, apiKey, project)
      .then((items) => {
        if (!alive) return
        setEnvironments(items)
        setEnv((current) => (items.includes(current) ? current : (items[0] ?? '')))
      })
      .catch(() => alive && setEnvironments([]))
      .finally(() => alive && setLoadingEnvironments(false))

    return () => {
      alive = false
    }
  }, [url, apiKey, project])

  // Only a reach naming one concrete environment can be narrowed to named
  // collections, so that is the only case worth listing them for.
  useEffect(() => {
    if (reach !== 'env' || !project || !env) {
      setCollections([])
      return
    }

    let alive = true
    api.collections
      .list(url, apiKey, { project, env })
      .then((items) => alive && setCollections(items.map((item) => item.name)))
      .catch(() => alive && setCollections([]))

    return () => {
      alive = false
    }
  }, [url, apiKey, project, env, reach])

  const input: NewKeyPlanInput = {
    reach,
    project,
    env,
    role,
    collections: narrowed ? selected : [],
    capabilities,
    transferReplace,
  }

  // Composition is a handful of string joins over a bounded permission list, so
  // it runs on every render rather than carrying a memo whose dependency list
  // would have to restate the whole form.
  const guidedClaims = NewKeyPlan.compose(input)

  const raw = useMemo(() => {
    if (rawText === null) return null

    const tokens = rawText.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean)
    try {
      return { claims: Claims.normalize(tokens), error: '' }
    } catch (caught: any) {
      return { claims: [] as Claim[], error: caught.message || 'Invalid claim' }
    }
  }, [rawText])

  const requestedClaims = raw ? raw.claims : guidedClaims

  // Both probes drop `capabilities`, so an undelegatable instance capability
  // greys out its own toggle in Advanced — where the reason is legible —
  // rather than every reach and role at once.
  const collectionsOnly = { capabilities: [], collections: [] }
  const blockedReaches: Partial<Record<KeyReach, string>> = {}
  for (const candidate of ['env', 'project', 'env-all-projects', 'instance'] as KeyReach[]) {
    const probe = NewKeyPlan.probe(input, { ...collectionsOnly, reach: candidate })
    if (!Claims.canDelegate(ownClaims, probe)) {
      blockedReaches[candidate] =
        `The current key holds no ${KeyRoles.labelOf(role).toLowerCase()} authority that wide.`
    }
  }

  const changeRole = (next: ClaimPreset) => {
    setRole(next)
    // Choices outside media (keys, transfer) are the user's and survive a role
    // change; the preset's own media grant is replaced.
    setCapabilities((current) =>
      Claims.normalize([
        ...Claims.presetFixedClaims(next).filter((claim) => Claims.has(ownClaims, claim)),
        ...current.filter((claim) => !KeyRoles.MediaClaims.includes(claim)),
      ]),
    )
  }

  const changeReach = (patch: ReachPatch) => {
    if (patch.project !== undefined || patch.env !== undefined) setScopeTouched(true)
    if (patch.reach !== undefined) setReach(patch.reach)
    if (patch.project !== undefined) setProject(patch.project)
    if (patch.env !== undefined) setEnv(patch.env)

    // A collection list belongs to the scope it was drawn from; carrying the
    // selection across a reach change would silently target a different one.
    if (patch.reach !== undefined || patch.project !== undefined || patch.env !== undefined) {
      setSelected([])
      setNarrowed(false)
    }
  }

  /** Every reason the form is not ready, in the order the user meets them. */
  const validate = (): string | null => {
    if (!label.trim()) return 'A label is required.'
    if (raw?.error) return raw.error

    if (role !== 'root' && !raw) {
      if ((reach === 'env' || reach === 'project') && !project) return 'Choose a project.'
      if ((reach === 'env' || reach === 'env-all-projects') && !env) {
        return 'Choose an environment.'
      }
      if (reach === 'env-all-projects' && !Claims.isScopeId(env)) {
        return `"${env}" is not a valid environment id.`
      }
      if (narrowed && selected.length === 0) {
        return 'Select at least one collection, or widen to all collections.'
      }
    }

    if (requestedClaims.length === 0) return 'Select at least one claim.'
    if (!Claims.canDelegate(ownClaims, requestedClaims)) {
      return 'The current key cannot delegate one or more selected claims.'
    }
    return null
  }

  return {
    label,
    setLabel,
    reach,
    project,
    env,
    role,
    narrowed,
    setNarrowed,
    selected,
    capabilities,
    transferReplace,
    setTransferReplace,
    rawText,
    setRawText,
    raw,
    environments,
    loadingEnvironments,
    collections,
    error,
    setError,
    busy,
    created,

    guidedClaims,
    requestedClaims,
    canDelegate: Claims.canDelegate(ownClaims, requestedClaims),
    planScope: NewKeyPlan.scope(input),
    describeScope: () => NewKeyPlan.describeScope(input),
    canNarrow: NewKeyPlan.canNarrow(input),
    blockedReaches,
    roleBlocked: (candidate: ClaimPreset) =>
      !Claims.canDelegate(
        ownClaims,
        NewKeyPlan.probe(input, { ...collectionsOnly, role: candidate }),
      ),

    changeRole,
    changeReach,
    toggleCapability: (claim: Claim) =>
      setCapabilities((current) =>
        current.includes(claim)
          ? current.filter((held) => held !== claim)
          : Claims.normalize([...current, claim]),
      ),
    toggleCollection: (name: string) =>
      setSelected((current) =>
        current.includes(name)
          ? current.filter((held) => held !== name)
          : [...current, name],
      ),

    submit: async () => {
      const problem = validate()
      if (problem) {
        setError(problem)
        return
      }

      setBusy(true)
      setError('')
      try {
        setCreated(await api.keys.create(url, apiKey, label.trim(), requestedClaims))
      } catch (caught: any) {
        setError(caught.message || 'Failed to create key')
      } finally {
        setBusy(false)
      }
    },
  }
}
