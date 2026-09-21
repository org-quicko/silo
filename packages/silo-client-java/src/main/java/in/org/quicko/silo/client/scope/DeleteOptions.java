package in.org.quicko.silo.client.scope;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What {@code delete()} accepts across projects, environments, collections and
 * media. {@code force} bypasses the server's "not empty" or "still referenced"
 * refusal, and the server asks for more claims when it is set.
 */
public record DeleteOptions(boolean force, RequestOptions request) {

  public DeleteOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static DeleteOptions none() {
    return new DeleteOptions(false, RequestOptions.none());
  }

  /** Deletes past whatever the server would otherwise refuse on. */
  public static DeleteOptions forced() {
    return new DeleteOptions(true, RequestOptions.none());
  }

  public DeleteOptions force(boolean value) {
    return new DeleteOptions(value, request);
  }

  public DeleteOptions request(RequestOptions value) {
    return new DeleteOptions(force, value);
  }
}
