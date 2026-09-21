package in.org.quicko.silo.client.query;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonCodec;
import java.util.List;

/**
 * A built filter, ready to combine or send. Wraps one {@link FilterNode} and
 * grows a bigger one on {@code and}/{@code or}/{@code not} rather than mutating
 * what it wraps, so {@code left.and(right).or(other)} never surprises a caller
 * still holding {@code left}.
 */
public final class FilterExpression {
  private final FilterNode node;

  public FilterExpression(FilterNode node) {
    this.node = node;
  }

  public FilterExpression and(FilterExpression other) {
    return new FilterExpression(FilterNode.group(FilterOperator.AND, List.of(node, other.node)));
  }

  public FilterExpression or(FilterExpression other) {
    return new FilterExpression(FilterNode.group(FilterOperator.OR, List.of(node, other.node)));
  }

  public FilterExpression not() {
    return new FilterExpression(FilterNode.group(FilterOperator.NOT, List.of(node)));
  }

  /** The AST this expression built. */
  public FilterNode node() {
    return node;
  }

  /** The wire shape: what {@code ?filter=} sends. */
  public JsonNode toJson(JsonCodec codec) {
    return node.toJson(codec);
  }
}
