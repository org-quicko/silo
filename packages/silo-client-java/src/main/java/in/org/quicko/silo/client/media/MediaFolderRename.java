package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;

/** Where a folder was, and where it now is. */
public record MediaFolderRename(String from, String to) {

  public static MediaFolderRename fromWire(JsonNode payload) {
    return new MediaFolderRename(JsonValues.text(payload, "from"), JsonValues.text(payload, "to"));
  }
}
