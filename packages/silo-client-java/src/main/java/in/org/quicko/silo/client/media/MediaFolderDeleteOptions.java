package in.org.quicko.silo.client.media;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What a folder delete accepts. {@code recursive} takes everything inside the
 * folder with it; {@code force} opts past a live reference among those assets
 * and is only meaningful with {@code recursive}, since without it nothing here
 * deletes anything at all.
 */
public record MediaFolderDeleteOptions(boolean recursive, boolean force, RequestOptions request) {

  public MediaFolderDeleteOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static MediaFolderDeleteOptions none() {
    return new MediaFolderDeleteOptions(false, false, RequestOptions.none());
  }

  /** Deletes the folder and everything under it. */
  public static MediaFolderDeleteOptions recursively() {
    return new MediaFolderDeleteOptions(true, false, RequestOptions.none());
  }

  public MediaFolderDeleteOptions force(boolean value) {
    return new MediaFolderDeleteOptions(recursive, value, request);
  }

  public MediaFolderDeleteOptions request(RequestOptions value) {
    return new MediaFolderDeleteOptions(recursive, force, value);
  }
}
