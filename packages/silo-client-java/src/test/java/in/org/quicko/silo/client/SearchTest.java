package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.search.SearchEngine;
import in.org.quicko.silo.client.search.SearchHit;
import in.org.quicko.silo.client.search.SearchPage;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.support.StubHttp;
import java.util.OptionalInt;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SearchTest {
  private static final String Hit =
      "{\"project\":\"acme\",\"env\":\"prod\",\"collection\":\"posts\",\"entry\":"
          + "{\"id\":\"01ABC\",\"rev\":1,\"created_at\":\"2026-09-01T10:00:00.000Z\","
          + "\"updated_at\":\"2026-09-01T10:00:00.000Z\",\"title\":\"Hello\"},"
          + "\"snippets\":[{\"path\":\"$.data.title\",\"before\":\"\",\"match\":\"Hello\",\"after\":\"\"}]}";

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private Silo silo() {
    return server.silo("k");
  }

  @Test
  void sendsTheTextAsTheParameterTheApiNames() {
    server.enqueueJson("{\"data\":[],\"total\":0,\"limit\":50,\"offset\":0,\"engine\":\"fts5\"}");
    silo().search(SearchQuery.matching("hello world"));

    assertEquals("/api/search?q=hello%20world", server.lastRequest().target());
  }

  @Test
  void theReachIsTheReceiverRatherThanAnArgument() {
    server.enqueueJson("{\"data\":[],\"total\":0,\"limit\":50,\"offset\":0,\"engine\":\"scan\"}");
    silo().scope("acme", "prod").search(SearchQuery.matching("x"));
    assertEquals("/api/projects/acme/envs/prod/search", server.lastRequest().path());

    server.enqueueJson("{\"data\":[],\"total\":0,\"limit\":50,\"offset\":0,\"engine\":\"scan\"}");
    silo().scope("acme", "prod").collection("posts").search(SearchQuery.matching("x"));
    assertEquals(
        "/api/projects/acme/envs/prod/collections/posts/search", server.lastRequest().path());
  }

  @Test
  void renamesTheHitsOwnLocationAndNothingInsideTheEntry() {
    server.enqueueJson(
        "{\"data\":[" + Hit + "],\"total\":1,\"limit\":50,\"offset\":0,\"engine\":\"fts5\"}");

    SearchPage page = silo().search(SearchQuery.matching("hello"));
    SearchHit hit = page.hits().get(0);

    assertEquals("prod", hit.environment());
    assertEquals("01ABC", hit.entry().id());
    assertEquals("Hello", hit.entry().fields().get("title"));
    assertEquals("$.data.title", hit.snippets().get(0).path());
    assertEquals(SearchEngine.FTS5, page.engine());
  }

  @Test
  void refusesToCountPagesForATruncatedScan() {
    server.enqueueJson("{\"data\":[" + Hit + "],\"total\":1,\"limit\":1,\"offset\":0,"
        + "\"engine\":\"scan\",\"truncated\":true}");

    SearchPage page = silo().search(SearchQuery.matching("hello"));

    assertTrue(page.truncated());
    assertEquals(OptionalInt.empty(), page.pageCount());
    assertTrue(page.hasMore(), "a full page is all a truncated scan leaves to go on");
  }
}
