package in.org.quicko.silo.client.errors;

/**
 * The request never reached the server. Deliberately NOT a {@link SiloException},
 * because nothing answered.
 *
 * <p>A {@code NetworkException} on a write does not prove the write did not
 * commit: reconcile by re-reading, do not blindly retry.
 */
public class NetworkException extends RuntimeException {
  private final String method;
  private final String path;

  public NetworkException(String method, String path, Throwable cause) {
    super("network error on " + method + " " + path
        + ": the request never reached the server" + reason(cause), cause);
    this.method = method;
    this.path = path;
  }

  public String method() {
    return method;
  }

  public String path() {
    return path;
  }

  /**
   * What the call failed with, in the message itself: a cause chain is printed
   * by some consoles and by no log line, and "never reached the server" alone
   * reads as a verdict on the network when the fault can be the call.
   */
  private static String reason(Throwable cause) {
    if (cause == null) return "";
    String message = cause.getMessage();
    return message == null || message.isEmpty() ? "" : " (" + message + ")";
  }
}
