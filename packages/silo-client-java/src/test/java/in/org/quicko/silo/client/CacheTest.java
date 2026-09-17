package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.cache.Cache;
import in.org.quicko.silo.client.cache.CacheKey;
import in.org.quicko.silo.client.cache.CacheOptions;
import in.org.quicko.silo.client.cache.CachePolicy;
import in.org.quicko.silo.client.cache.CacheStatistics;
import in.org.quicko.silo.client.collections.CollectionHandle;
import in.org.quicko.silo.client.entries.EntryListQuery;
import in.org.quicko.silo.client.entries.EntryReadOptions;
import in.org.quicko.silo.client.entries.EntryReader;
import in.org.quicko.silo.client.errors.NotFoundException;
import in.org.quicko.silo.client.support.FakeTicker;
import in.org.quicko.silo.client.support.Post;
import in.org.quicko.silo.client.support.StubHttp;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * What {@code @Cache} buys and what it costs. Every case counts requests at the
 * stub rather than reading the cache back, because the only claim worth making
 * is that a read did not reach the server.
 */
class CacheTest {
  private static final String Row =
      "{\"id\":\"01ABC\",\"rev\":3,\"created_at\":\"2026-09-01T10:00:00.000Z\","
          + "\"updated_at\":\"2026-09-02T11:30:00.000Z\",\"title\":\"Hello\"}";
  private static final String Page =
      "{\"data\":[" + Row + "],\"total\":1,\"limit\":50,\"offset\":0}";
  private static final String Collection = "/api/projects/acme/envs/prod/collections/posts";

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private CollectionHandle<Post> posts(Silo silo) {
    return silo.scope("acme", "prod").collection("posts", Post.class);
  }

  private CollectionHandle<Post> cachedPosts() {
    return posts(server.caching(CacheOptions.on()));
  }

  @Test
  void holdsNothingUntilTheCallerAsksForIt() {
    server.enqueueJson(Row).enqueueJson(Row);
    CollectionHandle<Post> posts = posts(server.silo("k"));

    posts.get("01ABC");
    posts.get("01ABC");

    assertEquals(2, server.requestCount(), "a client nobody asked to cache must not cache");
  }

  @Test
  void servesTheSecondReadOfOneEntryWithoutReachingTheServer() {
    server.enqueueJson(Row);
    CollectionHandle<Post> posts = cachedPosts();

    assertEquals("Hello", posts.get("01ABC").fields().title);
    assertEquals("Hello", posts.get("01ABC").fields().title);

    assertEquals(1, server.requestCount());
  }

  @Test
  void keysOnTheEntryAndNotOnTheCollection() {
    server.enqueueJson(Row).enqueueJson(Row);
    CollectionHandle<Post> posts = cachedPosts();

    posts.get("01ABC");
    posts.get("01XYZ");

    assertEquals(2, server.requestCount());
  }

  @Test
  void tellsARawReadApartFromAResolvedOne() {
    server.enqueueJson(Row).enqueueJson(Row);
    CollectionHandle<Post> posts = cachedPosts();

    posts.get("01ABC", EntryReadOptions.none());
    posts.get("01ABC", EntryReadOptions.raw());

    assertEquals(2, server.requestCount(), "the templates and what they resolve to are two reads");
  }

  @Test
  void keysAPageOnTheWindowItAskedFor() {
    server.enqueueJson(Page).enqueueJson(Page);
    CollectionHandle<Post> posts = cachedPosts();

    posts.list(EntryListQuery.all().limit(10));
    posts.list(EntryListQuery.all().limit(10));
    assertEquals(1, server.requestCount());

    posts.list(EntryListQuery.all().limit(20));
    assertEquals(2, server.requestCount());
  }

  @Test
  void dropsTheCollectionWhenThisClientWritesToIt() {
    server.enqueueJson(Row).enqueueJson(Row).enqueueJson(Row);
    CollectionHandle<Post> posts = cachedPosts();

    posts.get("01ABC");
    posts.replace("01ABC", 3, new Post());
    posts.get("01ABC");

    assertEquals(3, server.requestCount(), "a read after a write must not answer from before it");
  }

  @Test
  void dropsThePagesAnEntryAppearedOnWhenItIsDeleted() {
    server.enqueueJson(Page).enqueueNoContent().enqueueJson(Page);
    CollectionHandle<Post> posts = cachedPosts();

    posts.list();
    posts.delete("01ABC", 3);
    posts.list();

    assertEquals(3, server.requestCount());
  }

  @Test
  void leavesASiblingCollectionAloneWhenOneIsWrittenTo() {
    CacheKey page = new CacheKey("GET", Collection + "?limit=50");
    CacheKey row = new CacheKey("GET", Collection + "/01ABC");
    CacheKey sibling = new CacheKey("GET", Collection + "-archive");

    assertTrue(page.matches(Collection));
    assertTrue(row.matches(Collection));
    assertFalse(sibling.matches(Collection), "a prefix that stops mid-name addresses nothing");
  }

  @Test
  void stopsServingOnceTheTimeToLiveHasPassed() {
    server.enqueueJson(Row).enqueueJson(Row);
    FakeTicker clock = new FakeTicker();
    CollectionHandle<Post> posts = posts(server.caching(CacheOptions.on().ticker(clock)));

    posts.get("01ABC");
    clock.advance(Duration.ofSeconds(29));
    posts.get("01ABC");
    assertEquals(1, server.requestCount());

    clock.advance(Duration.ofSeconds(2));
    posts.get("01ABC");
    assertEquals(2, server.requestCount());
  }

  /** Each annotated read gets a Caffeine instance of its own, which is what
   *  lets the page's fifteen seconds expire while the entry's thirty have not. */
  @Test
  void holdsEachReadForAsLongAsItsOwnAnnotationSaid() {
    server.enqueueJson(Row).enqueueJson(Page).enqueueJson(Page);
    FakeTicker clock = new FakeTicker();
    CollectionHandle<Post> posts = posts(server.caching(CacheOptions.on().ticker(clock)));

    posts.get("01ABC");
    posts.list();
    clock.advance(Duration.ofSeconds(20));

    posts.get("01ABC");
    assertEquals(2, server.requestCount(), "the entry had thirty seconds");
    posts.list();
    assertEquals(3, server.requestCount(), "the page had fifteen");
  }

  @Test
  void remembersNothingAboutAReadThatFailed() {
    server
        .enqueue(404, "application/json", "{\"error\":{\"code\":\"not_found\",\"message\":\"gone\"}}")
        .enqueueJson(Row);
    CollectionHandle<Post> posts = cachedPosts();

    assertThrows(NotFoundException.class, () -> posts.get("01ABC"));
    assertEquals("Hello", posts.get("01ABC").fields().title);
  }

  @Test
  void startsEmptyForADifferentKey() {
    server.enqueueJson(Row).enqueueJson(Row);
    Silo silo = server.caching(CacheOptions.on());

    posts(silo).get("01ABC");
    posts(silo.withKey("other")).get("01ABC");

    assertEquals(2, server.requestCount(), "one key's reads are not another key's to serve");
  }

  @Test
  void clearsEverythingOnDemand() {
    server.enqueueJson(Row).enqueueJson(Row);
    Silo silo = server.caching(CacheOptions.on());

    posts(silo).get("01ABC");
    silo.cache().clear();
    posts(silo).get("01ABC");

    assertEquals(2, server.requestCount());
  }

  @Test
  void countsWhatItServedAndWhatItFetched() {
    server.enqueueJson(Row);
    Silo silo = server.caching(CacheOptions.on());

    posts(silo).get("01ABC");
    posts(silo).get("01ABC");

    CacheStatistics statistics = silo.cache().statistics();
    assertEquals(1, statistics.hits());
    assertEquals(1, statistics.misses());
    assertEquals(1, statistics.size());
  }

  /** A read of this test's own, so the resolution is observed rather than
   *  inferred from what EntryReader happens to declare. */
  @Cache(ttl = 45, maxSize = 12)
  private TransportRequest aReadThatDeclaredItsNumbers() {
    return TransportRequest.get("/posts").cache().build();
  }

  private TransportRequest aReadWithNoAnnotationAtAll() {
    return TransportRequest.get("/posts").cache().build();
  }

  @Cache(maxSize = 12)
  private TransportRequest aReadThatStatedOnlyABound() {
    return TransportRequest.get("/posts").cache().build();
  }

  @Cache
  private TransportRequest aReadThatStatedNothing() {
    return TransportRequest.get("/posts").cache().build();
  }

  @Test
  void takesItsNumbersFromTheAnnotationOnTheMethodThatAskedToCache() {
    CachePolicy resolved = aReadThatDeclaredItsNumbers().cachePolicy();

    assertEquals(Duration.ofSeconds(45), resolved.ttl());
    assertEquals(12, resolved.maxSize());
  }

  @Test
  void refusesToCacheAReadWithNoAnnotationAtAll() {
    IllegalStateException refused =
        assertThrows(IllegalStateException.class, this::aReadWithNoAnnotationAtAll);

    assertTrue(refused.getMessage().contains("no @Cache"), refused.getMessage());
  }

  @Test
  void refusesAPolicyNoReadCouldBeServedFrom() {
    assertThrows(IllegalArgumentException.class, () -> new CachePolicy(Duration.ZERO, 10L));
    assertThrows(
        IllegalArgumentException.class, () -> new CachePolicy(Duration.ofSeconds(1), 0L));
  }

  @Test
  void keepsTheTimeToLiveTheReadStatedOverTheOneTheCallerSet() {
    server.enqueueJson(Row).enqueueJson(Row);
    FakeTicker clock = new FakeTicker();
    CollectionHandle<Post> posts = posts(
        server.caching(CacheOptions.on(Duration.ofMinutes(10), 50).ticker(clock)));

    posts.get("01ABC");
    clock.advance(Duration.ofSeconds(31));
    posts.get("01ABC");

    assertEquals(2, server.requestCount(), "get() states 30s, and that is what governs it");
  }

  /** What reaches Caffeine, rather than what Caffeine then does with it: its
   *  size eviction is asynchronous, and asserting on it would test the library. */
  @Test
  void putsWhatTheReadStatedOverWhatTheConsumerSet() {
    CachePolicy declared = new CachePolicy(Duration.ofSeconds(30), 1024L);
    CacheOptions options = CacheOptions.on().ttl(Duration.ofMinutes(5)).maxSize(50_000);

    CachePolicy inForce = options.inForce(declared);
    assertEquals(Duration.ofSeconds(30), inForce.ttl());
    assertEquals(1024, inForce.maxSize());
  }

  @Test
  void fallsBackToTheConsumersNumberWhereTheReadStatedNone() {
    CachePolicy declared = aReadThatStatedOnlyABound().cachePolicy();
    CacheOptions options = CacheOptions.on(Duration.ofMinutes(5), 99);

    CachePolicy inForce = options.inForce(declared);
    assertEquals(Duration.ofMinutes(5), inForce.ttl(), "the read left the ttl to the consumer");
    assertEquals(12, inForce.maxSize(), "and kept the bound it stated itself");
  }

  @Test
  void refusesANumberNeitherSideNamed() {
    CachePolicy declared = aReadThatStatedNothing().cachePolicy();

    IllegalStateException refused =
        assertThrows(IllegalStateException.class, () -> CacheOptions.on().inForce(declared));
    assertTrue(refused.getMessage().contains("no ttl"), refused.getMessage());
  }


  @Test
  void keepsWhatTheAnnotationDeclaredWhenTheConsumerSaysNothing() {
    CachePolicy declared = new CachePolicy(Duration.ofSeconds(15), 256L);

    assertEquals(declared, CacheOptions.on().inForce(declared));
  }

  @Test
  void holdsNothingForAClientTheConsumerLeftOff() {
    CachePolicy declared = new CachePolicy(Duration.ofSeconds(30), 1024L);

    assertNull(CacheOptions.off().inForce(declared));
  }

  @Test
  void annotatesOnlyTheTwoReadsThatReachTheServer() {
    long annotated = 0;
    for (Method method : EntryReader.class.getDeclaredMethods()) {
      if (method.isAnnotationPresent(Cache.class)) annotated++;
    }

    assertEquals(
        2, annotated, "all() and pages() page through list(), and declare no policy of their own");
  }

  @Test
  void takesEveryParameterIntoTheKey() {
    Map<String, Object> query = new LinkedHashMap<>();
    query.put("limit", 50);
    query.put("offset", 0);

    assertEquals("/posts?limit=50&offset=0", CacheKey.of("GET", "/posts", query).key());
  }

  @Test
  void leavesOutAParameterThatWasNeverSent() {
    Map<String, Object> query = new LinkedHashMap<>();
    query.put("limit", 50);
    query.put("sort", null);

    assertEquals("/posts?limit=50", CacheKey.of("GET", "/posts", query).key());
  }

  @Test
  void ordersTheParametersSoTwoCallersMeetOneEntry() {
    Map<String, Object> asked = new LinkedHashMap<>();
    asked.put("sort", "title");
    asked.put("limit", 50);

    Map<String, Object> askedTheOtherWay = new LinkedHashMap<>();
    askedTheOtherWay.put("limit", 50);
    askedTheOtherWay.put("sort", "title");

    assertEquals(
        CacheKey.of("GET", "/posts", asked),
        CacheKey.of("GET", "/posts", askedTheOtherWay));
  }

  @Test
  void tellsTwoMethodsAtOneAddressApart() {
    assertNotEquals(
        CacheKey.of("GET", "/posts", Map.of()), CacheKey.of("HEAD", "/posts", Map.of()));
  }

  @Test
  void encodesAValueThatWouldOtherwiseForgeAnotherReadsKey() {
    Map<String, Object> forged = new LinkedHashMap<>();
    forged.put("filter", "a&limit=1");

    Map<String, Object> honest = new LinkedHashMap<>();
    honest.put("filter", "a");
    honest.put("limit", 1);

    assertNotEquals(
        CacheKey.of("GET", "/posts", forged),
        CacheKey.of("GET", "/posts", honest),
        "an ampersand in a value must not read as a parameter boundary");
  }

  @Test
  void leavesThePathAsThePrefixSoAWriteCanStillSweepIt() {
    CacheKey key = CacheKey.of("GET", Collection, Map.of("limit", 50));

    assertTrue(key.matches(Collection));
  }
}
