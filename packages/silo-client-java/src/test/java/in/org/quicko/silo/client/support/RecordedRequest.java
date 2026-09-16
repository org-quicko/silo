package in.org.quicko.silo.client.support;

import java.util.Map;

/** One request {@link StubHttp} saw, as a test wants to read it back. */
public record RecordedRequest(
    String method,
    String path,
    String query,
    String contentType,
    Map<String, String> headers,
    String body) {

  public String header(String name) {
    return headers.get(name.toLowerCase());
  }

  /** The path with its query string, which is what most assertions are about. */
  public String target() {
    return query == null || query.isEmpty() ? path : path + "?" + query;
  }
}
