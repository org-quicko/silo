import { useCallback, useState } from 'react'
import { Claims } from '@silo/shared/claims'
import { api } from '../../../api/silo-api'
import type { ScopeRef } from '../../../api/types/scope-ref'
import type { Variable } from '../../../api/types/variable'
import { invalidateProjectVariables, useVariables } from '../../../store/use-variables'
import { ToastManager } from '../../../utils/toast-manager'

/**
 * What the Variables page can do, and what this key is allowed to do with it
 * (D57).
 *
 * The two `can…` flags mirror the route guards claim for claim, so the page
 * hides an affordance rather than offering one that answers 403 — the rule
 * `media-force-availability.ts` already follows for the force gate. Getting
 * them wrong is only a cosmetic bug: the server is still the enforcement point.
 */
export interface VariablesForm {
  variables: Variable[]
  loading: boolean
  loaded: boolean
  /** The read failed. A 403 lands here too, which is the honest thing to show:
   *  the list is not empty, it is not readable. */
  error: string | null
  /** Whichever write is in flight, by variable name, so one row can be busy
   *  without freezing the rest of the page. `''` is the add form. */
  busy: string | null
  writeError: string | null
  clearWriteError: () => void

  /** Setting or clearing a value here. Reaches this environment only. */
  canSetValue: boolean
  /** Declaring, renaming and undeclaring. Reaches every environment. */
  canDeclare: boolean
  canUndeclare: boolean

  declare: (input: { name: string; description: string; value: string }) => Promise<boolean>
  setValue: (name: string, value: string) => Promise<boolean>
  clearValue: (name: string) => Promise<boolean>
  rename: (name: string, next: string) => Promise<boolean>
  describe: (name: string, description: string) => Promise<boolean>
  undeclare: (name: string) => Promise<boolean>
}

export function useVariablesForm(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  claims: string[],
): VariablesForm {
  const resource = useVariables(serverId, url, apiKey, scope)
  const [busy, setBusy] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)

  // A value rewrites what every entry in this environment answers, so the page
  // asks for the environment-wide update the route asks for.
  const canSetValue = Claims.hasScopeWide(
    claims,
    [Claims.CollectionEntriesUpdate],
    scope.project,
    scope.env,
  )
  // A declaration reaches every environment in the project, so it asks at the
  // project. `hasScopeWide` with `*` as the env is exactly that question.
  const canDeclare = Claims.hasScopeWide(claims, [Claims.CollectionCreate], scope.project, '*')
  const canUndeclare = Claims.hasScopeWide(claims, [Claims.CollectionDelete], scope.project, '*')

  /**
   * Runs one write, then reloads.
   *
   * `reach` decides how much cache goes: a value is this environment's, so the
   * one list is refreshed; a declaration is the project's, so every
   * environment's cached copy has to go or a sibling environment would keep
   * naming a variable that no longer exists.
   */
  const run = useCallback(
    async (
      name: string,
      reach: 'environment' | 'project',
      work: () => Promise<unknown>,
      done: string,
    ): Promise<boolean> => {
      setBusy(name)
      setWriteError(null)
      try {
        await work()
        if (reach === 'project') invalidateProjectVariables(serverId, scope.project)
        await resource.refresh()
        ToastManager.show(done)
        return true
      } catch (caught) {
        setWriteError(caught instanceof Error ? caught.message : String(caught))
        return false
      } finally {
        setBusy(null)
      }
    },
    [serverId, scope.project, resource],
  )

  return {
    variables: resource.variables,
    loading: resource.loading,
    loaded: resource.loaded,
    error: resource.error,
    busy,
    writeError,
    clearWriteError: () => setWriteError(null),
    canSetValue,
    canDeclare,
    canUndeclare,

    declare: (input) =>
      run(
        '',
        'project',
        () =>
          api.variables.declare(url, apiKey, scope, {
            name: input.name,
            description: input.description,
            // An empty box means "declare it, leave this environment unset",
            // which is a different state from an empty value and the one an
            // operator adding a name for later actually wants.
            value: input.value === '' ? undefined : input.value,
          }),
        `Declared ${input.name} in ${scope.project}`,
      ),

    setValue: (name, value) =>
      run(
        name,
        'environment',
        () => api.variables.setValue(url, apiKey, scope, name, value),
        `Saved ${name} for ${scope.env}`,
      ),

    clearValue: (name) =>
      run(
        name,
        'environment',
        () => api.variables.clearValue(url, apiKey, scope, name),
        `Cleared ${name} in ${scope.env}`,
      ),

    rename: (name, next) =>
      run(
        name,
        'project',
        () => api.variables.updateDeclaration(url, apiKey, scope, name, { name: next }),
        `Renamed ${name} to ${next}`,
      ),

    describe: (name, description) =>
      run(
        name,
        'project',
        () => api.variables.updateDeclaration(url, apiKey, scope, name, { description }),
        `Updated ${name}`,
      ),

    undeclare: (name) =>
      run(
        name,
        'project',
        () => api.variables.undeclare(url, apiKey, scope, name),
        `Removed ${name} from ${scope.project}`,
      ),
  }
}
