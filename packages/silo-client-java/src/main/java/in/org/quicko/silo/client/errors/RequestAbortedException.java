package in.org.quicko.silo.client.errors;

/**
 * The caller's own {@link in.org.quicko.silo.client.CancellationSignal} fired.
 * Distinct from {@link RequestTimeoutException}: this one is the caller changing
 * its mind, not a deadline the client imposed.
 */
public class RequestAbortedException extends RuntimeException {
  private final String method;
  private final String path;

  public RequestAbortedException(String method, String path) {
    super(method + " " + path + " was cancelled by the caller");
    this.method = method;
    this.path = path;
  }

  public String method() {
    return method;
  }

  public String path() {
    return path;
  }
}
