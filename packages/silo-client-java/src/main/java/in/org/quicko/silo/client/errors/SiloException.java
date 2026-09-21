package in.org.quicko.silo.client.errors;

/**
 * The base for every error the server itself answered: it received the request
 * and refused it. {@code status} and {@code code} are the wire's; {@code method}
 * and {@code path} say what was being attempted.
 *
 * <p>Unchecked, deliberately: every call in this client can fail this way, and a
 * checked exception would put {@code throws} on every signature including the
 * {@link java.util.Iterator} a paging stream returns, which cannot declare one.
 */
public class SiloException extends RuntimeException {
  private final int status;
  private final String code;
  private final String method;
  private final String path;

  public SiloException(int status, String code, String message, String method, String path) {
    super(message);
    this.status = status;
    this.code = code;
    this.method = method;
    this.path = path;
  }

  /** The HTTP status the server answered. */
  public int status() {
    return status;
  }

  /**
   * The wire's {@code error.code}, verbatim. Branch on the exception type
   * rather than on this string — the type is what the taxonomy is for, and a
   * code this client does not know still arrives here intact.
   */
  public String code() {
    return code;
  }

  public String method() {
    return method;
  }

  public String path() {
    return path;
  }
}
