package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.collections.CollectionHandle;
import in.org.quicko.silo.client.entries.Entry;
import in.org.quicko.silo.client.entries.EntryListQuery;
import in.org.quicko.silo.client.entries.EntryPage;
import in.org.quicko.silo.client.entries.EntryReadOptions;
import in.org.quicko.silo.client.query.Filter;
import in.org.quicko.silo.client.query.Sort;
import in.org.quicko.silo.client.support.Post;
import in.org.quicko.silo.client.support.RecordedRequest;
import in.org.quicko.silo.client.support.StubHttp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EntriesTest {
  private static final String Row =
      "{\"id\":\"01ABC\",\"rev\":3,\"created_at\":\"2026-09-01T10:00:00.000Z\","
          + "\"updated_at\":\"2026-09-02T11:30:00.000Z\","
          + "\"title\":\"Hello\",\"status\":\"published\",\"tags\":[\"java\"]}";

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private CollectionHandle<Post> posts() {
    return server.silo("k").scope("acme", "prod").collection("posts", Post.class);
  }

  @Test
  void splitsTheFlatRowIntoTheEnvelopeAndTheAuthorsFields() {
    server.enqueueJson(Row);
    Entry<Post> entry = posts().get("01ABC");

    assertEquals("01ABC", entry.id());
    assertEquals(3, entry.rev());
    assertEquals(Instant.parse("2026-09-01T10:00:00Z"), entry.createdAt());
    assertEquals(Instant.parse("2026-09-02T11:30:00Z"), entry.updatedAt());
    assertEquals("Hello", entry.fields().title);
    assertEquals(List.of("java"), entry.fields().tags);
  }

  @Test
  void leavesTheAuthorsOwnKeysExactlyAsTheyArrived() {
    server.enqueueJson(
        "{\"id\":\"01ABC\",\"rev\":1,\"created_at\":\"2026-09-01T10:00:00.000Z\","
            + "\"updated_at\":\"2026-09-01T10:00:00.000Z\",\"product_code\":\"AB-1\"}");

    Entry<Map<String, Object>> entry =
        server.anonymous().scope("acme", "prod").collection("things").get("01ABC");

    assertEquals(Map.of("product_code", "AB-1"), entry.fields());
  }

  @Test
  void resolvesVariablesByDefaultAndAsksForTheTemplatesOnlyWhenTold() {
    server.enqueueJson(Row);
    posts().get("01ABC");
    assertEquals("/api/projects/acme/envs/prod/collections/posts/01ABC", server.lastRequest().target());

    server.enqueueJson(Row);
    posts().get("01ABC", EntryReadOptions.raw());
    assertEquals(
        "/api/projects/acme/envs/prod/collections/posts/01ABC?variables=raw",
        server.lastRequest().target());
  }

  @Test
  void bothWritesAskForTheStoredTemplatesBack() {
    server.enqueueJson(Row);
    posts().create(new Post("Hello", "published", List.of("java")));
    RecordedRequest created = server.lastRequest();
    assertEquals("POST", created.method());
    assertEquals("/api/projects/acme/envs/prod/collections/posts?variables=raw", created.target());
    assertTrue(created.body().contains("\"title\":\"Hello\""));

    server.enqueueJson(Row);
    posts().replace("01ABC", 3, new Post("Hello again", "draft", List.of()));
    RecordedRequest replaced = server.lastRequest();
    assertEquals("PUT", replaced.method());
    assertEquals(
        "/api/projects/acme/envs/prod/collections/posts/01ABC?rev=3&variables=raw",
        replaced.target());
  }

  @Test
  void sendsTheRevisionADeleteIsBoundTo() {
    server.enqueueNoContent();
    posts().delete("01ABC", 7);

    RecordedRequest request = server.lastRequest();
    assertEquals("DELETE", request.method());
    assertEquals("/api/projects/acme/envs/prod/collections/posts/01ABC?rev=7", request.target());
  }

  @Test
  void buildsTheFilterAndSortOntoTheQueryString() {
    server.enqueueJson("{\"data\":[" + Row + "],\"total\":1,\"limit\":50,\"offset\":0}");

    posts().list(EntryListQuery.all()
        .where(Filter.field("status").isEqualTo("published"))
        .sort(Sort.recentlyUpdated())
        .limit(20));

    String target = server.lastRequest().target();
    assertTrue(target.contains("limit=20"), target);
    assertTrue(target.contains("sort=-%24.updated_at"), target);
    assertTrue(target.contains("filter=%7B%22op%22%3A%22eq%22"), target);
  }

  @Test
  void pagesByTheWindowTheServerAnsweredRatherThanTheOneRequested() {
    server.enqueueJson("{\"data\":[" + Row + "],\"total\":600,\"limit\":500,\"offset\":0}");
    EntryPage<Post> page = posts().list(EntryListQuery.all().limit(900));

    assertEquals(500, page.limit());
    assertTrue(page.hasMore());

    server.enqueueJson("{\"data\":[],\"total\":600,\"limit\":500,\"offset\":500}");
    page.next().orElseThrow();

    assertTrue(server.lastRequest().target().contains("offset=500"), server.lastRequest().target());
    assertFalse(server.lastRequest().target().contains("offset=900"));
  }
}
