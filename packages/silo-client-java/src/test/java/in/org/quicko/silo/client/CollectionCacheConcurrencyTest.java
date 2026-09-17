package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.Test;

class CollectionCacheConcurrencyTest {
  @Test
  void clearingDuringAReadPreventsItsLateResponseFromReplacingNewData() throws Exception {
    CountDownLatch firstReadStarted = new CountDownLatch(1);
    CountDownLatch finishFirstRead = new CountDownLatch(1);
    AtomicInteger requests = new AtomicInteger();
    try (MockWebServer server = new MockWebServer();
        var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      server.setDispatcher(new Dispatcher() {
        @Override
        public MockResponse dispatch(RecordedRequest request) throws InterruptedException {
          boolean isFirst = requests.getAndIncrement() == 0;
          if (isFirst) {
            firstReadStarted.countDown();
            if (!finishFirstRead.await(5, TimeUnit.SECONDS)) return new MockResponse().setResponseCode(500);
          }
          return new MockResponse().setHeader("Content-Type", "application/json")
              .setBody("{\"id\":\"one\",\"title\":\"" + (isFirst ? "Old" : "New") + "\"}");
        }
      });
      server.start();
      Silo silo = Silo.builder().baseUrl(server.url("/").toString()).timeout(Duration.ofSeconds(5))
          .cache(cache -> cache.ttl(Duration.ofMinutes(10))).build();
      var posts = silo.scope("acme", "dev").collection("posts");
      var pending = executor.submit(() -> posts.get("one"));
      try {
        assertTrue(firstReadStarted.await(3, TimeUnit.SECONDS));
        silo.clearCache();
        assertEquals("New", posts.get("one").fields().get("title"));
      } finally {
        finishFirstRead.countDown();
      }
      assertEquals("Old", pending.get(3, TimeUnit.SECONDS).fields().get("title"));
      assertEquals("New", posts.get("one").fields().get("title"));
      assertEquals(2, server.getRequestCount());
    }
  }
}
