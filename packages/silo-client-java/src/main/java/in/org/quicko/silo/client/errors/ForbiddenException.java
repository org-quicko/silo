package in.org.quicko.silo.client.errors;

/** A {@code 403}: the key is valid but does not hold the claim this call needs. */
public class ForbiddenException extends SiloException {
  public ForbiddenException(String message, String method, String path) {
    super(403, "forbidden", message, method, path);
  }
}
