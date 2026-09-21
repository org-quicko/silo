package in.org.quicko.silo.client.entries;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import in.org.quicko.silo.client.transport.JsonCodec;
import in.org.quicko.silo.client.transport.Timestamps;
import java.util.Iterator;
import java.util.Set;

/**
 * Splits the wire's flat row into the envelope and the author's fields — the
 * only place in the client that knows the envelope's four names.
 *
 * <p>Every other key is copied across untouched, whatever it is called. A
 * recursive rename would rewrite a customer's {@code product_code}, the schema
 * property that validates it, and the {@code {{API_URL}}} inside it.
 */
public final class EntryMapper {
  /** The four keys silo adds to every row. No field can collide with them:
   *  silo refuses a schema declaring one and an entry carrying one. */
  private static final Set<String> EnvelopeKeys = Set.of("id", "rev", "created_at", "updated_at");

  private EntryMapper() {}

  public static <F> Entry<F> read(JsonNode row, JavaType fieldsType, JsonCodec codec) {
    ObjectNode fields = codec.object();
    Iterator<String> names = row.fieldNames();
    while (names.hasNext()) {
      String name = names.next();
      if (!EnvelopeKeys.contains(name)) fields.set(name, row.get(name));
    }

    return new Entry<>(
        row.path("id").asText(""),
        row.path("rev").asLong(0),
        Timestamps.at(row, "created_at"),
        Timestamps.at(row, "updated_at"),
        codec.convert(fields, fieldsType));
  }
}
