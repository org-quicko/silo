import { FieldPath } from "./field-path.js";
import { FilterExpression } from "./filter-expression.js";
import { FilterField } from "./filter-field.js";
import type { FilterNode } from "./filter-node.js";

/** A plain field of `Fields`, or a dotted/bracketed extension of one —
 * `"author.name"` and `"tags[0]"` stay valid even though neither is a key
 * of `Fields` by itself. */
type TypedFieldPath<Fields> =
  | (keyof Fields & string)
  | `${keyof Fields & string}.${string}`
  | `${keyof Fields & string}[${string}]`;

/** The value an operator on `Key` should accept: `Fields[Key]` when `Key` is
 * a plain field, `unknown` for a dotted or bracketed extension, whose
 * target type this client cannot resolve statically. */
type TypedFieldValue<Fields, Key extends string> = Key extends keyof Fields ? Fields[Key] : unknown;

/** `each` walks one element of an array field at a time, so its operators
 * take the element type — `each("tags")` on `tags: string[]` should accept
 * a `string`, not a `string[]`. */
type TypedEachValue<Fields, Key extends string> = Key extends keyof Fields
  ? Fields[Key] extends readonly (infer Element)[]
    ? Element
    : Fields[Key]
  : unknown;

/**
 * `Filter`'s surface, typed to one collection's fields:
 * `posts.filter.field("status")` autocompletes `keyof Post`, and
 * `posts.filter.field("stauts")` does not compile. `meta`, `and`, `or`,
 * `not` and `raw` are untyped, the same as on `Filter`, since they do not
 * address `Fields` at all.
 */
export class TypedFilter<Fields> {
  field<Key extends TypedFieldPath<Fields>>(name: Key): FilterField<TypedFieldValue<Fields, Key>> {
    return new FilterField(FieldPath.field(name));
  }

  each<Key extends TypedFieldPath<Fields>>(name: Key): FilterField<TypedEachValue<Fields, Key>> {
    return new FilterField(FieldPath.each(name));
  }

  meta(name: string): FilterField {
    return new FilterField(FieldPath.meta(name));
  }

  and(left: FilterExpression, right: FilterExpression): FilterExpression {
    return left.and(right);
  }

  or(left: FilterExpression, right: FilterExpression): FilterExpression {
    return left.or(right);
  }

  not(expression: FilterExpression): FilterExpression {
    return expression.not();
  }

  raw(node: FilterNode): FilterExpression {
    return new FilterExpression(node);
  }
}
