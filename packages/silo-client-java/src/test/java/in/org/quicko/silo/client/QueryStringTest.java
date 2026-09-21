package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;

import in.org.quicko.silo.client.query.Filter;
import in.org.quicko.silo.client.transport.JsonCodec;
import in.org.quicko.silo.client.transport.QueryString;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class QueryStringTest {
  private final JsonCodec codec = new JsonCodec(JsonCodec.defaultMapper());

  @Test
  void answersNothingWhenNothingIsSet() {
    assertEquals("", QueryString.build(Map.of()));
    assertEquals("", QueryString.build(null));
  }

  @Test
  void omitsANullValueRatherThanSendingTheWordNull() {
    Map<String, Object> query = new LinkedHashMap<>();
    query.put("limit", 10);
    query.put("offset", null);
    assertEquals("?limit=10", QueryString.build(query));
  }

  @Test
  void joinsParametersInTheOrderTheyWereSet() {
    Map<String, Object> query = new LinkedHashMap<>();
    query.put("limit", 10);
    query.put("offset", 20);
    assertEquals("?limit=10&offset=20", QueryString.build(query));
  }

  @Test
  void jsonEncodesTheFilterAstBeforeUrlEncodingIt() {
    Map<String, Object> query = new LinkedHashMap<>();
    query.put("filter", Filter.field("status").isEqualTo("published").toJson(codec));

    assertEquals(
        "?filter=%7B%22op%22%3A%22eq%22%2C%22path%22%3A%22%24.data.status%22%2C%22value%22%3A%22published%22%7D",
        QueryString.build(query));
  }
}
