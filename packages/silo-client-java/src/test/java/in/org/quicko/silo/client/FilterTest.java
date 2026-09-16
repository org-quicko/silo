package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;

import in.org.quicko.silo.client.query.Filter;
import in.org.quicko.silo.client.query.Sort;
import in.org.quicko.silo.client.transport.JsonCodec;
import java.util.List;
import org.junit.jupiter.api.Test;

class FilterTest {
  private final JsonCodec codec = new JsonCodec(JsonCodec.defaultMapper());

  @Test
  void addressesADataFieldWithTheDataPrefix() {
    assertEquals(
        "{\"op\":\"eq\",\"path\":\"$.data.status\",\"value\":\"published\"}",
        json(Filter.field("status").isEqualTo("published")));
  }

  @Test
  void addressesTheEnvelopeWithoutIt() {
    assertEquals(
        "{\"op\":\"gt\",\"path\":\"$.updated_at\",\"value\":\"2026-01-01\"}",
        json(Filter.meta("updated_at").greaterThan("2026-01-01")));
  }

  @Test
  void writesTheWildcardForAnArrayFieldSoNobodyTypesIt() {
    assertEquals(
        "{\"op\":\"eq\",\"path\":\"$.data.tags[*]\",\"value\":\"java\"}",
        json(Filter.each("tags").isEqualTo("java")));
  }

  @Test
  void tellsTheTwoWildcardSpellingsApart() {
    String someTagIsNotJava = json(Filter.each("tags").isNotEqualTo("java"));
    String noTagIsJava = json(Filter.not(Filter.each("tags").isEqualTo("java")));

    assertEquals("{\"op\":\"neq\",\"path\":\"$.data.tags[*]\",\"value\":\"java\"}", someTagIsNotJava);
    assertEquals(
        "{\"op\":\"not\",\"args\":[{\"op\":\"eq\",\"path\":\"$.data.tags[*]\",\"value\":\"java\"}]}",
        noTagIsJava);
  }

  @Test
  void omitsAnOperandTheLeafDoesNotTake() {
    assertEquals("{\"op\":\"exists\",\"path\":\"$.data.author\"}", json(Filter.field("author").exists()));
  }

  @Test
  void sendsAListForOneOf() {
    assertEquals(
        "{\"op\":\"in\",\"path\":\"$.data.status\",\"value\":[\"draft\",\"review\"]}",
        json(Filter.field("status").oneOf(List.of("draft", "review"))));
  }

  @Test
  void growsANewExpressionRatherThanMutatingTheOneItWraps() {
    var left = Filter.field("status").isEqualTo("published");
    var right = Filter.field("author").isEqualTo("ada");
    var combined = left.and(right);

    assertEquals("{\"op\":\"eq\",\"path\":\"$.data.status\",\"value\":\"published\"}", json(left));
    assertEquals(
        "{\"op\":\"and\",\"args\":["
            + "{\"op\":\"eq\",\"path\":\"$.data.status\",\"value\":\"published\"},"
            + "{\"op\":\"eq\",\"path\":\"$.data.author\",\"value\":\"ada\"}]}",
        json(combined));
  }

  @Test
  void namesASortForItsFieldRatherThanForRecency() {
    assertEquals("-$.updated_at", Sort.recentlyUpdated().toString());
    assertEquals("-$.created_at", Sort.recentlyCreated().toString());
    assertEquals("$.data.title", Sort.by("title").toString());
    assertEquals("$.data.title,-$.updated_at", Sort.of(Sort.by("title"), Sort.recentlyUpdated()));
  }

  private String json(in.org.quicko.silo.client.query.FilterExpression expression) {
    return expression.toJson(codec).toString();
  }
}
