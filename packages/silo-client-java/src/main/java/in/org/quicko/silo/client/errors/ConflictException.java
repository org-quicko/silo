package in.org.quicko.silo.client.errors;

/**
 * A {@code 409}. {@code code} defaults to {@code "conflict"} (a stale revision);
 * a subclass like {@link MediaInUseException} passes its own more specific wire code.
 */
public class ConflictException extends SiloException {
  public ConflictException(String message, String method, String path) {
    this(message, method, path, "conflict");
  }

  protected ConflictException(String message, String method, String path, String code) {
    super(409, code, message, method, path);
  }
}
