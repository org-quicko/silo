package in.org.quicko.silo.client.errors;

/** A {@code 401}: no key, or a key the server does not recognise. */
public class UnauthorizedException extends SiloException {
  public UnauthorizedException(String message, String method, String path) {
    super(401, "unauthorized", message, method, path);
  }
}
