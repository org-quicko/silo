package in.org.quicko.silo.client.cache;

import in.org.quicko.silo.client.transport.QueryString;
import java.util.Map;
import java.util.TreeMap;

/**
 * What a stored response is filed under: the method, and the path with its
 * query after it. Nothing names the read that made it, because two reads cannot
 * meet at one key without being one request.
 *
 * <p>Why the request identifies the response rather than a method's arguments:
 * {@code docs/design/java-client.md} §15.8.
 */
public record CacheKey(String method, String key) {

  /** Built with {@link QueryString}, the same code that builds the URL, with
   *  the parameters sorted so two callers who set them in a different order
   *  still meet one entry. */
  public static CacheKey of(String method, String path, Map<String, Object> query) {
    return new CacheKey(method, path + QueryString.build(sorted(query)));
  }

  /**
   * Whether a write to {@code path} leaves this response stale.
   *
   * <p>The two suffixes are the point: a plain {@code startsWith} would let a
   * write to {@code .../posts} also drop {@code .../posts-archive}, which is a
   * different collection.
   */
  public boolean matches(String path) {
    return key.equals(path)
        || key.startsWith(path + "/")
        || key.startsWith(path + "?");
  }

  private static Map<String, Object> sorted(Map<String, Object> query) {
    return query == null ? Map.of() : new TreeMap<>(query);
  }
}
