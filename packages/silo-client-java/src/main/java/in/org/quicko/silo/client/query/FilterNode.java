package in.org.quicko.silo.client.query;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import in.org.quicko.silo.client.transport.JsonCodec;
import java.util.List;

/**
 * One node of the wire's filter AST: a leaf tests {@code path} against
 * {@code value}, a group combines nested nodes in {@code args}.
 */
public record FilterNode(FilterOperator op, String path, Object value, List<FilterNode> args) {

  public FilterNode {
    args = args == null ? List.of() : List.copyOf(args);
  }

  public static FilterNode leaf(FilterOperator op, String path, Object value) {
    return new FilterNode(op, path, value, List.of());
  }

  /** A leaf that takes no operand, which is {@code exists}. */
  public static FilterNode predicate(FilterOperator op, String path) {
    return new FilterNode(op, path, null, List.of());
  }

  public static FilterNode group(FilterOperator op, List<FilterNode> args) {
    return new FilterNode(op, null, null, args);
  }

  /**
   * The wire shape, exactly as {@code ?filter=} sends it: absent keys rather
   * than nulls, because silo validates the AST and a null {@code path} on a
   * group is not a node it accepts.
   */
  public JsonNode toJson(JsonCodec codec) {
    ObjectNode node = codec.object();
    node.put("op", op.wireValue());
    if (path != null) node.put("path", path);
    if (value != null) node.set("value", codec.toNode(value));
    if (!args.isEmpty()) {
      ArrayNode nested = node.putArray("args");
      args.forEach(argument -> nested.add(argument.toJson(codec)));
    }
    return node;
  }
}
