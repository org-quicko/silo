package in.org.quicko.silo.client.errors;

import java.time.Duration;

/**
 * The deadline fired before an answer came back. Distinct from
 * {@link RequestAbortedException} so a caller can tell "this took too long" from
 * "I cancelled this" without inspecting a reason.
 *
 * <p>Named {@code RequestTimeoutException} rather than {@code TimeoutException}
 * so it does not collide with {@link java.util.concurrent.TimeoutException} at
 * every import site.
 */
public class RequestTimeoutException extends RuntimeException {
  private final String method;
  private final String path;
  private final Duration timeout;

  public RequestTimeoutException(String method, String path, Duration timeout) {
    super(method + " " + path + " timed out after " + timeout.toMillis() + "ms");
    this.method = method;
    this.path = path;
    this.timeout = timeout;
  }

  public String method() {
    return method;
  }

  public String path() {
    return path;
  }

  public Duration timeout() {
    return timeout;
  }
}
