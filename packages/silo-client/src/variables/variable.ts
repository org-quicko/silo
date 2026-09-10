import type { VariableDeclaration } from "./variable-declaration.js";

/**
 * One `{{NAME}}` declaration as one environment sees it. `value` is
 * `null` when this environment has given it nothing — not `""`, which is a
 * value in its own right. The name itself is never rewritten: it is
 * case-sensitive `UPPER_SNAKE` content, not metadata.
 */
export class Variable {
  private constructor(
    readonly name: string,
    readonly description: string,
    readonly value: string | null,
    readonly setIn: number,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  static fromWire(payload: VariableDeclaration): Variable {
    return new Variable(
      payload.name,
      payload.description,
      payload.value,
      payload.set_in,
      new Date(payload.created_at),
      new Date(payload.updated_at),
    );
  }
}
