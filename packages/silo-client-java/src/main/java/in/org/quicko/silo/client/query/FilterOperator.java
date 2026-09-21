package in.org.quicko.silo.client.query;

/**
 * The closed set of operators the filter AST accepts: nine leaves that test one
 * path, and three groups that combine nested nodes.
 */
public enum FilterOperator {
  EQUALS("eq"),
  NOT_EQUALS("neq"),
  GREATER_THAN("gt"),
  AT_LEAST("gte"),
  LESS_THAN("lt"),
  AT_MOST("lte"),
  IN("in"),
  CONTAINS("contains"),
  EXISTS("exists"),
  AND("and"),
  OR("or"),
  NOT("not");

  private final String wireValue;

  FilterOperator(String wireValue) {
    this.wireValue = wireValue;
  }

  /** What goes into the AST's {@code op}. */
  public String wireValue() {
    return wireValue;
  }

  public static FilterOperator of(String wireValue) {
    for (FilterOperator operator : values()) {
      if (operator.wireValue.equals(wireValue)) return operator;
    }
    throw new IllegalArgumentException("not a filter operator silo accepts: " + wireValue);
  }
}
