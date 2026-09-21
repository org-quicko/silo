package in.org.quicko.silo.client.media;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What a folder rename or move accepts. {@code merge} opts into joining an
 * existing destination instead of refusing on collision.
 */
public record MediaFolderMoveOptions(boolean merge, RequestOptions request) {

  public MediaFolderMoveOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static MediaFolderMoveOptions none() {
    return new MediaFolderMoveOptions(false, RequestOptions.none());
  }

  /** Joins the destination folder rather than refusing to collide with it. */
  public static MediaFolderMoveOptions merging() {
    return new MediaFolderMoveOptions(true, RequestOptions.none());
  }

  public MediaFolderMoveOptions request(RequestOptions value) {
    return new MediaFolderMoveOptions(merge, value);
  }
}
