package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;

/** What rode along, counted at delete time. */
public record TrashContents(long collections, long entries, long assets, long bytes) {

  public static TrashContents fromWire(JsonNode payload) {
    return new TrashContents(
        payload.path("collections").asLong(0),
        payload.path("entries").asLong(0),
        payload.path("assets").asLong(0),
        payload.path("bytes").asLong(0));
  }
}
