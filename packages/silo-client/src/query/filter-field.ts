import { FilterExpression } from "./filter-expression.js";

/**
 * One path awaiting an operator. Generic over `Value` so `TypedFilter` can
 * constrain what an operator accepts to the field's declared type, while
 * `Filter`'s untyped statics leave it as `unknown`.
 */
export class FilterField<Value = unknown> {
  constructor(private readonly path: string) {}

  equals(value: Value): FilterExpression {
    return new FilterExpression({ op: "eq", path: this.path, value });
  }

  notEquals(value: Value): FilterExpression {
    return new FilterExpression({ op: "neq", path: this.path, value });
  }

  contains(value: Value): FilterExpression {
    return new FilterExpression({ op: "contains", path: this.path, value });
  }

  greaterThan(value: Value): FilterExpression {
    return new FilterExpression({ op: "gt", path: this.path, value });
  }

  atLeast(value: Value): FilterExpression {
    return new FilterExpression({ op: "gte", path: this.path, value });
  }

  lessThan(value: Value): FilterExpression {
    return new FilterExpression({ op: "lt", path: this.path, value });
  }

  atMost(value: Value): FilterExpression {
    return new FilterExpression({ op: "lte", path: this.path, value });
  }

  oneOf(values: Value[]): FilterExpression {
    return new FilterExpression({ op: "in", path: this.path, value: values });
  }

  exists(): FilterExpression {
    return new FilterExpression({ op: "exists", path: this.path });
  }
}
