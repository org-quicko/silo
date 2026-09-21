package in.org.quicko.silo.client.query;

import java.util.List;

/**
 * One path awaiting an operator.
 *
 * <p>Equality is {@code isEqualTo} rather than the TypeScript client's
 * {@code equals}: a one-argument {@code equals} here would override
 * {@link Object#equals(Object)} instead of building a filter.
 */
public final class FilterField {
  private final String path;

  public FilterField(String path) {
    this.path = path;
  }

  public FilterExpression isEqualTo(Object value) {
    return leaf(FilterOperator.EQUALS, value);
  }

  public FilterExpression isNotEqualTo(Object value) {
    return leaf(FilterOperator.NOT_EQUALS, value);
  }

  public FilterExpression contains(Object value) {
    return leaf(FilterOperator.CONTAINS, value);
  }

  public FilterExpression greaterThan(Object value) {
    return leaf(FilterOperator.GREATER_THAN, value);
  }

  public FilterExpression atLeast(Object value) {
    return leaf(FilterOperator.AT_LEAST, value);
  }

  public FilterExpression lessThan(Object value) {
    return leaf(FilterOperator.LESS_THAN, value);
  }

  public FilterExpression atMost(Object value) {
    return leaf(FilterOperator.AT_MOST, value);
  }

  public FilterExpression oneOf(List<?> values) {
    return leaf(FilterOperator.IN, values);
  }

  public FilterExpression oneOf(Object... values) {
    return oneOf(List.of(values));
  }

  public FilterExpression exists() {
    return new FilterExpression(FilterNode.predicate(FilterOperator.EXISTS, path));
  }

  private FilterExpression leaf(FilterOperator operator, Object value) {
    return new FilterExpression(FilterNode.leaf(operator, path, value));
  }
}
