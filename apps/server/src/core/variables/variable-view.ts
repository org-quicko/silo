/**
 * One variable as the API answers it, for one environment (D57).
 *
 * `value` is **this** environment's, and `null` means the project declares the
 * name and this environment has given it nothing — distinct from `""`, which is
 * a value somebody chose. `set_in` counts how many of the project's
 * environments have a value, so the admin can say "set in 2 of 3" without
 * fetching every environment's variables to work it out, and no environment
 * ever learns another's *value* from this shape.
 */
export interface VariableView {
  name: string;
  description: string;
  value: string | null;
  set_in: number;
  created_at: string;
  updated_at: string;
}
