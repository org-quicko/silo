package in.org.quicko.silo.client.trash;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What {@code trash.restore()} accepts. {@code chain} restores the containers
 * blocking the receipt first; {@code rename} applies to the subject alone, for
 * when its name was taken meanwhile.
 */
public record TrashRestoreOptions(String rename, boolean chain, RequestOptions request) {

  public TrashRestoreOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static TrashRestoreOptions none() {
    return new TrashRestoreOptions(null, false, RequestOptions.none());
  }

  public TrashRestoreOptions rename(String value) {
    return new TrashRestoreOptions(value, chain, request);
  }

  public TrashRestoreOptions chain(boolean value) {
    return new TrashRestoreOptions(rename, value, request);
  }

  public TrashRestoreOptions request(RequestOptions value) {
    return new TrashRestoreOptions(rename, chain, value);
  }
}
