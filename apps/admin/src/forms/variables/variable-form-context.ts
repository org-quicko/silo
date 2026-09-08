import type { Variable } from '../../api/types/variable'

/**
 * What the entry form passes down so a field can talk about variables (D57).
 *
 * Carried on RJSF's `formContext` rather than a React context, because that is
 * how `url` and `apiKey` already reach `MediaWidget` — RJSF builds its own tree
 * and a provider outside it would not be visible to a widget rendered inside.
 *
 * `manageHref` is a URL rather than a callback so the CTA can be a real link:
 * middle-click and "open in new tab" work, and the reader can look up a value
 * without losing the entry they are part-way through writing.
 */
export interface VariableFormContext {
  /** Every variable the project declares, valued for the environment being
   *  edited. Empty when the key cannot read them, which simply shows nothing. */
  variables: readonly Variable[]
  /** The environment these values belong to, named in the affordance so nobody
   *  reads a `dev` value as the one `prod` will substitute. */
  env: string
  /** Link to this environment's Variables settings page. */
  manageHref: string
}

/** Reads the block off whichever of RJSF's two shapes a caller was handed. */
export function variableContextOf(props: {
  registry?: { formContext?: unknown }
  formContext?: unknown
}): VariableFormContext | null {
  const context = (props.registry?.formContext ?? props.formContext) as
    | { variables?: VariableFormContext }
    | undefined
  return context?.variables ?? null
}
