import { FieldPath } from "./field-path.js";
import { FilterExpression } from "./filter-expression.js";
import { FilterField } from "./filter-field.js";
import type { FilterNode } from "./filter-node.js";

/**
 * The untyped filter statics, for a filter built from user input at runtime
 * or a caller not using `collection<Fields>()`. `TypedFilter` offers the
 * same surface, typed to a collection's fields.
 */
export class Filter {
  static field(name: string): FilterField {
    return new FilterField(FieldPath.field(name));
  }

  static each(name: string): FilterField {
    return new FilterField(FieldPath.each(name));
  }

  static meta(name: string): FilterField {
    return new FilterField(FieldPath.meta(name));
  }

  static and(left: FilterExpression, right: FilterExpression): FilterExpression {
    return left.and(right);
  }

  static or(left: FilterExpression, right: FilterExpression): FilterExpression {
    return left.or(right);
  }

  static not(expression: FilterExpression): FilterExpression {
    return expression.not();
  }

  /** The escape hatch: wraps a hand-built node exactly as given. */
  static raw(node: FilterNode): FilterExpression {
    return new FilterExpression(node);
  }
}
