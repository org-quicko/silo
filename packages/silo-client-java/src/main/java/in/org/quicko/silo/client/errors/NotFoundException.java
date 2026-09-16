package in.org.quicko.silo.client.errors;

/**
 * A {@code 404}: the project, environment, collection, entry or asset named in
 * the path does not exist. A handle built before a rename answers this, which is
 * the honest outcome of handles being immutable.
 */
public class NotFoundException extends SiloException {
  public NotFoundException(String message, String method, String path) {
    super(404, "not_found", message, method, path);
  }
}
