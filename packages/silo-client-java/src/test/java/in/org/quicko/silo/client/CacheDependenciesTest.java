package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Map;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.Test;

class CacheDependenciesTest {
  @Test
  void uncachedClientsWorkWithoutTheOptionalSpringDependencies() throws Exception {
    ArrayList<URL> classpath = new ArrayList<>();
    for (String entry : System.getProperty("surefire.test.class.path").split(File.pathSeparator)) {
      String normalized = entry.replace('\\', '/');
      if (!normalized.contains("/org/springframework/") && !normalized.contains("/io/micrometer/")) {
        classpath.add(Path.of(entry).toUri().toURL());
      }
    }
    try (URLClassLoader loader = new URLClassLoader(classpath.toArray(URL[]::new),
            ClassLoader.getPlatformClassLoader());
        MockWebServer server = new MockWebServer()) {
      server.start();
      server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
          .setBody("{\"id\":\"one\",\"title\":\"Before\"}"));
      server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
          .setBody("{\"id\":\"one\",\"title\":\"After\"}"));
      assertThrows(ClassNotFoundException.class,
          () -> loader.loadClass("org.springframework.cache.CacheManager"));

      Class<?> siloClass = loader.loadClass("in.org.quicko.silo.client.Silo");
      Object silo = siloClass.getMethod("at", String.class).invoke(null, server.url("/").toString());
      Object scope = siloClass.getMethod("scope", String.class, String.class).invoke(silo, "acme", "dev");
      Object posts = scope.getClass().getMethod("collection", String.class).invoke(scope, "posts");
      assertEquals("Before", readTitle(posts));
      assertEquals("After", readTitle(posts));
      siloClass.getMethod("clearCache").invoke(silo);
      assertEquals(2, server.getRequestCount());
    }
  }

  private Object readTitle(Object posts) throws Exception {
    Object entry = posts.getClass().getMethod("get", String.class).invoke(posts, "one");
    Map<?, ?> fields = (Map<?, ?>) entry.getClass().getMethod("fields").invoke(entry);
    return fields.get("title");
  }
}
