/**
 * One variable, as one environment sees it (D57).
 *
 * The name and description belong to the **project** and read the same in every
 * environment; `value` and `set_in` are what change as you switch environment.
 *
 * `value` is `null` when this environment has given it nothing, which is not
 * the same as `''` — an empty value substitutes as empty, an unset one leaves
 * `{{NAME}}` standing in the API response. The page says which.
 */
export interface Variable {
  name: string
  description: string
  value: string | null
  /** How many of the project's environments have a value for it. */
  set_in: number
  created_at: string
  updated_at: string
}
