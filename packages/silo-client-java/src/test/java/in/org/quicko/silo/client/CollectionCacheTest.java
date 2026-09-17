package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import in.org.quicko.silo.client.entries.EntryReadOptions;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import in.org.quicko.silo.client.errors.NotFoundException;
import in.org.quicko.silo.client.errors.InvalidResponseException;
import in.org.quicko.silo.client.support.Post;
import java.util.List;
import java.time.Duration;
import in.org.quicko.silo.client.search.SearchQuery;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CollectionCacheTest {
  private MockWebServer server;

  @BeforeEach
  void startServer() throws Exception {
    server = new MockWebServer();
    server.start();
  }

  @AfterEach
  void stopServer() throws Exception {
    server.close();
  }

  @Test
  void reusesCollectionJsonAcrossHandlesWithoutSharingMutableFields() {
    server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
        .setBody("{\"id\":\"one\",\"rev\":1,\"title\":\"Original\"}"));
    Silo silo = Silo.builder().baseUrl(server.url("/").toString()).apiKey("test-key")
        .cache(cache -> cache.ttl(Duration.ofMinutes(10)).maximumSize(100))
        .build();

    var first = silo.scope("acme", "dev").collection("posts").get("one");
    first.fields().put("title", "Changed by caller");
    var second = silo.scope("acme", "dev").collection("posts").get("one");

    assertEquals("Original", second.fields().get("title"));
    assertEquals(1, server.getRequestCount());
  }

  @Test
  void cachesCollectionSchemaReadsAndReturnsAnIndependentSchema() {
    enqueue("{\"id\":\"posts\",\"name\":\"posts\",\"schema\":{\"type\":\"object\"}}");
    enqueue("{\"id\":\"changed\",\"name\":\"changed\",\"schema\":{\"type\":\"object\"}}");
    Silo silo = cached();
    var schema = silo.scope("acme", "dev").collection("posts").schema();

    var first = schema.get();
    ((com.fasterxml.jackson.databind.node.ObjectNode) first.schema().document()).put("title", "Mutated");
    var second = schema.get();

    assertEquals("posts", second.name());
    assertFalse(second.schema().document().has("title"));
    assertEquals(1, server.getRequestCount());
  }

  @Test
  void cachesCollectionSearch() {
    String search = "{\"data\":[],\"total\":0,\"limit\":10,\"offset\":0,\"engine\":\"scan\"}";
    enqueue(search);
    enqueue(search);
    Silo silo = cached();
    var posts = silo.scope("acme", "dev").collection("posts");
    posts.search(SearchQuery.matching("hello world").limit(10));
    posts.search(SearchQuery.matching("hello world").limit(10));
    assertEquals(1, server.getRequestCount());
  }

  private Silo cached() {
    return Silo.builder().baseUrl(server.url("/").toString())
        .timeout(Duration.ofSeconds(3))
        .cache(cache -> cache.ttl(Duration.ofMinutes(10))).build();
  }

  @Test
  void honoursCancellationEvenWhenTheResponseIsCached() {
    enqueue("{\"id\":\"one\",\"title\":\"Original\"}");
    var posts = cached().scope("acme", "dev").collection("posts");
    posts.get("one");
    CancellationSignal cancellation = CancellationSignal.create();
    cancellation.cancel();

    assertThrows(RequestAbortedException.class,
        () -> posts.get("one", EntryReadOptions.none().request(RequestOptions.until(cancellation))));
    assertEquals(1, server.getRequestCount());
  }

  private void enqueue(String body) {
    server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody(body));
  }

  @Test
  void leavesCachingDisabledByDefaultAndHealthUncachedWhenEnabled() {
    enqueue("{\"id\":\"one\",\"title\":\"Before\"}");
    enqueue("{\"id\":\"one\",\"title\":\"After\"}");
    Silo uncached = Silo.builder().baseUrl(server.url("/").toString()).build();
    var posts = uncached.scope("acme", "dev").collection("posts");
    assertEquals("Before", posts.get("one").fields().get("title"));
    assertEquals("After", posts.get("one").fields().get("title"));

    enqueue("{\"status\":\"ok\",\"version\":\"1\"}");
    enqueue("{\"status\":\"ok\",\"version\":\"2\"}");
    Silo cached = cached();
    assertEquals("1", cached.health().version());
    assertEquals("2", cached.health().version());
    uncached.clearCache();
    assertEquals(4, server.getRequestCount());
  }

  @Test
  void keepsClientsAndDerivedClientsIsolated() {
    Silo silo = cached();
    List<Silo> clients = List.of(silo, cached(), silo.withKey("another-key"),
        silo.withUrl(server.url("/").toString()), silo.toBuilder().build());
    for (int index = 0; index < clients.size(); index++) {
      enqueue("{\"id\":\"one\",\"title\":\"client-" + index + "\"}");
      var posts = clients.get(index).scope("acme", "dev").collection("posts");
      assertEquals("client-" + index, posts.get("one").fields().get("title"));
      assertEquals("client-" + index, posts.get("one").fields().get("title"));
    }
    assertEquals(5, server.getRequestCount());
  }

  @Test
  void decodesTheSameCachedJsonIntoDifferentFieldTypes() {
    enqueue("{\"id\":\"one\",\"title\":\"Original\",\"tags\":[\"java\"]}");
    Silo silo = cached();
    var typed = silo.scope("acme", "dev").collection("posts", Post.class).get("one");
    typed.fields().tags.add("mutated");
    var untyped = silo.scope("acme", "dev").collection("posts").get("one");
    assertEquals(List.of("java"), untyped.fields().get("tags"));
    assertEquals(1, server.getRequestCount());
  }

  @Test
  void expiresAfterTheConfiguredTtlAndCanBeClearedExplicitly() throws Exception {
    Silo silo = Silo.builder().baseUrl(server.url("/").toString())
        .cache(cache -> cache.ttl(Duration.ofMillis(80))).build();
    var posts = silo.scope("acme", "dev").collection("posts");
    enqueue("{\"id\":\"one\",\"title\":\"Before\"}");
    assertEquals("Before", posts.get("one").fields().get("title"));
    Thread.sleep(150);
    enqueue("{\"id\":\"one\",\"title\":\"After expiry\"}");
    assertEquals("After expiry", posts.get("one").fields().get("title"));
    silo.clearCache();
    enqueue("{\"id\":\"one\",\"title\":\"After clear\"}");
    assertEquals("After clear", posts.get("one").fields().get("title"));
    assertEquals(3, server.getRequestCount());
  }

  @Test
  void keysIncludeEncodedPathAndVariableResolution() throws Exception {
    Silo silo = cached();
    var posts = silo.scope("acme/team", "dev").collection("posts");
    enqueue("{\"id\":\"one\",\"title\":\"Resolved\"}");
    enqueue("{\"id\":\"one\",\"title\":\"{{TITLE}}\"}");
    enqueue("{\"id\":\"two\",\"title\":\"Another entry\"}");
    assertEquals("Resolved", posts.get("one /a").fields().get("title"));
    assertEquals("{{TITLE}}", posts.get("one /a", EntryReadOptions.raw()).fields().get("title"));
    assertEquals("Resolved", posts.get("one /a").fields().get("title"));
    assertEquals("Another entry", posts.get("two").fields().get("title"));
    assertEquals("/api/projects/acme%2Fteam/envs/dev/collections/posts/one%20%2Fa",
        server.takeRequest().getPath());
    assertEquals("/api/projects/acme%2Fteam/envs/dev/collections/posts/one%20%2Fa?variables=raw",
        server.takeRequest().getPath());
    assertEquals(3, server.getRequestCount());
  }

  @Test
  void doesNotCacheErrorsInvalidJsonOrEmptyResponses() {
    var posts = cached().scope("acme", "dev").collection("posts");
    server.enqueue(new MockResponse().setResponseCode(404)
        .setBody("{\"error\":{\"code\":\"not_found\",\"message\":\"missing\"}}"));
    assertThrows(NotFoundException.class, () -> posts.get("one"));
    enqueue("{invalid json");
    assertThrows(IllegalStateException.class, () -> posts.get("one"));
    server.enqueue(new MockResponse().setHeader("Content-Type", "text/html").setBody("<html/>"));
    assertThrows(InvalidResponseException.class, () -> posts.get("one"));
    server.enqueue(new MockResponse().setResponseCode(204));
    assertThrows(RuntimeException.class, () -> posts.get("one"));
    enqueue("null");
    assertThrows(RuntimeException.class, () -> posts.get("one"));
    enqueue("{\"id\":\"one\",\"title\":\"Recovered\"}");
    assertEquals("Recovered", posts.get("one").fields().get("title"));
    assertEquals("Recovered", posts.get("one").fields().get("title"));
    assertEquals(6, server.getRequestCount());
  }

  @Test
  void requiresPositiveTtlAndCapacity() {
    assertThrows(IllegalArgumentException.class, () -> Silo.builder().cache(cache -> {}));
    assertThrows(IllegalArgumentException.class,
        () -> Silo.builder().cache(cache -> cache.ttl(Duration.ZERO)));
    assertThrows(IllegalArgumentException.class,
        () -> Silo.builder().cache(cache -> cache.ttl(Duration.ofSeconds(-1))));
    assertThrows(IllegalArgumentException.class,
        () -> Silo.builder().cache(cache -> cache.ttl(Duration.ofSeconds(1)).maximumSize(0)));
  }
}
