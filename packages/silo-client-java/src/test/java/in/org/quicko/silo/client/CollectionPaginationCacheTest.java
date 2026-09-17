package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import in.org.quicko.silo.client.entries.EntryListQuery;
import in.org.quicko.silo.client.entries.EntryReadOptions;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import in.org.quicko.silo.client.query.Filter;
import in.org.quicko.silo.client.search.SearchQuery;
import java.time.Duration;
import java.util.List;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CollectionPaginationCacheTest {
  private MockWebServer server;
  private Silo silo;

  @BeforeEach
  void startServer() throws Exception {
    server = new MockWebServer();
    server.start();
    silo = Silo.builder().baseUrl(server.url("/").toString()).timeout(Duration.ofSeconds(3))
        .cache(cache -> cache.ttl(Duration.ofMinutes(10))).build();
  }

  @AfterEach
  void stopServer() throws Exception {
    server.close();
  }

  @Test
  void listAllAndPagesReuseResponsesWithFreshNavigationCallbacks() {
    enqueue("{\"data\":[{\"id\":\"one\"}],\"total\":1,\"limit\":1,\"offset\":0}");
    enqueue("{\"data\":[],\"total\":1,\"limit\":1,\"offset\":1}");
    var posts = silo.scope("acme", "dev").collection("posts");
    var query = EntryListQuery.all().limit(1).offset(0);
    CancellationSignal firstCaller = CancellationSignal.create();
    posts.list(query, EntryReadOptions.none().request(RequestOptions.until(firstCaller)));
    firstCaller.cancel();

    assertEquals("one", posts.list(query).entries().getFirst().id());
    assertEquals(List.of("one"), posts.all(query).toList().stream().map(entry -> entry.id()).toList());
    int pageCount = 0;
    for (var page : posts.pages(query)) {
      assertEquals("one", page.entries().getFirst().id());
      pageCount++;
    }
    assertEquals(1, pageCount);
    assertEquals(2, server.getRequestCount());

    assertThrows(RequestAbortedException.class,
        () -> posts.list(query, EntryReadOptions.none().request(RequestOptions.until(firstCaller))));
  }

  @Test
  void nextAndPreviousUseCachedPagesWithoutCapturingAnotherCallersCancellation() {
    enqueue("{\"data\":[{\"id\":\"one\"}],\"total\":2,\"limit\":1,\"offset\":0}");
    enqueue("{\"data\":[{\"id\":\"two\"}],\"total\":2,\"limit\":1,\"offset\":1}");
    var posts = silo.scope("acme", "dev").collection("posts");
    var query = EntryListQuery.all().limit(1).offset(0);
    CancellationSignal firstCaller = CancellationSignal.create();
    var oldPage = posts.list(query, EntryReadOptions.none().request(RequestOptions.until(firstCaller)));
    firstCaller.cancel();
    var page = posts.list(query);
    var next = page.next().orElseThrow();

    assertEquals("two", next.entries().getFirst().id());
    assertEquals("one", next.previous().orElseThrow().entries().getFirst().id());
    assertEquals("two", page.next().orElseThrow().entries().getFirst().id());
    assertThrows(RequestAbortedException.class, oldPage::next);
    assertEquals(2, server.getRequestCount());
  }

  @Test
  void searchPagesReuseResponsesWhileOtherSearchReachesRemainUncached() {
    String first = "{\"data\":[{\"entry\":{\"id\":\"one\"},\"snippets\":[]}],"
        + "\"total\":2,\"limit\":1,\"offset\":0,\"engine\":\"scan\"}";
    String second = first.replace("one", "two").replace("\"offset\":0", "\"offset\":1");
    enqueue(first);
    enqueue(second);
    var posts = silo.scope("acme", "dev").collection("posts");
    var query = SearchQuery.matching("hello").limit(1).offset(0);
    CancellationSignal firstCaller = CancellationSignal.create();
    var oldPage = posts.search(query, RequestOptions.until(firstCaller));
    firstCaller.cancel();
    var page = posts.search(query);
    var next = page.next().orElseThrow();
    assertEquals("two", next.hits().getFirst().entry().id());
    assertEquals("one", next.previous().orElseThrow().hits().getFirst().entry().id());
    assertThrows(RequestAbortedException.class, oldPage::next);
    assertEquals(2, server.getRequestCount());

    for (int index = 0; index < 4; index++) enqueue(first);
    silo.search(query);
    silo.search(query);
    silo.scope("acme", "dev").search(query);
    silo.scope("acme", "dev").search(query);
    assertEquals(6, server.getRequestCount());
  }

  @Test
  void listAndSearchKeysKeepEveryQueryParameter() {
    String empty = "{\"data\":[],\"total\":0,\"limit\":1,\"offset\":0,\"engine\":\"scan\"}";
    var posts = silo.scope("acme", "dev").collection("posts");
    var lists = List.of(EntryListQuery.all(), EntryListQuery.all().limit(2),
        EntryListQuery.all().offset(2), EntryListQuery.all().sort("title"),
        EntryListQuery.all().where(Filter.field("title").isEqualTo("a")));
    for (var query : lists) {
      enqueue(empty);
      posts.list(query);
      posts.list(query);
    }
    enqueue(empty);
    posts.list(EntryListQuery.all(), EntryReadOptions.raw());
    posts.list(EntryListQuery.all(), EntryReadOptions.raw());
    var searches = List.of(SearchQuery.matching("a"), SearchQuery.matching("b"),
        SearchQuery.matching("a").limit(2), SearchQuery.matching("a").offset(2),
        SearchQuery.matching("a").sort("title"),
        SearchQuery.matching("a").where(Filter.field("title").isEqualTo("a")));
    for (var query : searches) {
      enqueue(empty);
      posts.search(query);
      posts.search(query);
    }
    assertEquals(12, server.getRequestCount());
  }

  private void enqueue(String body) {
    server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody(body));
  }
}
