package in.org.quicko.silo.client.errors;

/**
 * A {@code 500} with no more specific code: the server has a bug, or hit a
 * failure it does not describe further.
 */
public class InternalException extends SiloException {
  public InternalException(String message, String method, String path) {
    super(500, "internal", message, method, path);
  }
}
