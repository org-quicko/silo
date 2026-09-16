package in.org.quicko.silo.client.transport;

import in.org.quicko.silo.client.RequestOptions;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One request through {@link Transport}: an HTTP method and a path already built
 * by {@link ApiPath}, with everything else optional.
 *
 * <p>Built rather than constructed, because most requests set two of six fields
 * and a six-argument constructor at forty call sites is unreadable.
 */
public final class TransportRequest {
  private final String method;
  private final String path;
  private final Map<String, Object> query;
  private final Object body;
  private final Map<String, String> headers;
  private final RequestOptions options;

  private TransportRequest(Builder builder) {
    this.method = builder.method;
    this.path = builder.path;
    // Not Map.copyOf: that answers an unordered map, and a query string whose
    // parameter order changes between runs is one nothing can cache or diff.
    this.query = Collections.unmodifiableMap(new LinkedHashMap<>(builder.query));
    this.body = builder.body;
    this.headers = Collections.unmodifiableMap(new LinkedHashMap<>(builder.headers));
    this.options = builder.options == null ? RequestOptions.none() : builder.options;
  }

  public static Builder of(String method, String path) {
    return new Builder(method, path);
  }

  public static Builder get(String path) {
    return of("GET", path);
  }

  public static Builder post(String path) {
    return of("POST", path);
  }

  public static Builder put(String path) {
    return of("PUT", path);
  }

  public static Builder patch(String path) {
    return of("PATCH", path);
  }

  public static Builder delete(String path) {
    return of("DELETE", path);
  }

  public String method() {
    return method;
  }

  public String path() {
    return path;
  }

  public Map<String, Object> query() {
    return query;
  }

  public Object body() {
    return body;
  }

  public Map<String, String> headers() {
    return headers;
  }

  public RequestOptions options() {
    return options;
  }

  /** Mutable while the request is being described, frozen by {@link #build()}. */
  public static final class Builder {
    private final String method;
    private final String path;
    private final Map<String, Object> query = new LinkedHashMap<>();
    private final Map<String, String> headers = new LinkedHashMap<>();
    private Object body;
    private RequestOptions options;

    private Builder(String method, String path) {
      this.method = method;
      this.path = path;
    }

    /** A null value is kept out of the query string, never sent as "null". */
    public Builder query(String name, Object value) {
      if (value != null) query.put(name, value);
      return this;
    }

    public Builder queries(Map<String, Object> values) {
      values.forEach(this::query);
      return this;
    }

    public Builder body(Object value) {
      this.body = value;
      return this;
    }

    public Builder header(String name, String value) {
      if (value != null) headers.put(name, value);
      return this;
    }

    public Builder options(RequestOptions value) {
      this.options = value;
      return this;
    }

    public TransportRequest build() {
      return new TransportRequest(this);
    }
  }
}
