package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.List;
import java.util.Map;

/**
 * The library's folder tree: {@code list}, {@code create}, {@code rename} and
 * {@code delete}. A folder is an explicit record, so one can exist before
 * anything is filed into it.
 */
public final class MediaFolders {
  private final Transport transport;

  public MediaFolders(Transport transport) {
    this.transport = transport;
  }

  public List<String> list() {
    return list(RequestOptions.none());
  }

  public List<String> list(RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.mediaFolders()).options(options).build());
    return JsonValues.strings(body.get("items"));
  }

  public String create(String path) {
    return create(path, RequestOptions.none());
  }

  /** Answers the path the server settled on. */
  public String create(String path, RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.post(ApiPath.mediaFolders())
            .body(Map.of("path", path))
            .options(options)
            .build());
    return JsonValues.text(body, "path");
  }

  public MediaFolderRename rename(String from, String to) {
    return rename(from, to, MediaFolderMoveOptions.none());
  }

  /** Renames or moves a folder, and every asset in the subtree with it. No
   *  entry is touched and no blob moves: an asset is addressed by its id. */
  public MediaFolderRename rename(String from, String to, MediaFolderMoveOptions options) {
    return MediaFolderRename.fromWire(transport.json(
        TransportRequest.patch(ApiPath.mediaFolders())
            .body(Map.of("from", from, "to", to, "merge", options.merge()))
            .options(options.request())
            .build()));
  }

  public void delete(String path) {
    delete(path, MediaFolderDeleteOptions.none());
  }

  /** The folder path travels as {@code ?path=} rather than a path segment,
   *  because it contains slashes of its own. */
  public void delete(String path, MediaFolderDeleteOptions options) {
    transport.empty(
        TransportRequest.delete(ApiPath.mediaFolders())
            .query("path", path)
            .query("recursive", options.recursive() ? true : null)
            .query("force", options.force() ? true : null)
            .options(options.request())
            .build());
  }
}
