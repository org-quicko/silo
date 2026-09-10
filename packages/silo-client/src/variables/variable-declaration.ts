/** The wire's `VariableView`: one declaration as one environment sees it.
 *  `value: null` means this environment has not set it. */
export interface VariableDeclaration {
  name: string;
  description: string;
  value: string | null;
  set_in: number;
  created_at: string;
  updated_at: string;
}
