package in.org.quicko.silo.client.errors;

/**
 * A {@code 2xx} carried a body its route does not promise — an HTML proxy page
 * in front of a JSON route, say. Distinct from {@link SiloException}: the
 * request succeeded, and what is wrong is the shape of the answer, not a refusal.
 */
public class InvalidResponseException extends RuntimeException {
  private final String method;
  private final String path;
  private final String contentType;

  public InvalidResponseException(String method, String path, String contentType) {
    super(method + " " + path + " answered with content-type \"" + contentType
        + "\", not the JSON this route promises");
    this.method = method;
    this.path = path;
    this.contentType = contentType;
  }

  public String method() {
    return method;
  }

  public String path() {
    return path;
  }

  public String contentType() {
    return contentType;
  }
}
