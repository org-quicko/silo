package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.errors.InvalidResponseException;

/**
 * Decodes a successful response by its content type: {@code 204} and an empty
 * body to null, {@code application/json} to a parsed tree, everything else to a
 * refusal when JSON was promised.
 */
public final class ResponseDecoder {
  private ResponseDecoder() {}

  public static JsonNode decode(
      int status, String contentType, String rawBody, TransportRequest request, JsonCodec json, boolean expectJson) {
    if (status == 204 || rawBody == null || rawBody.isEmpty()) return null;

    String type = contentType == null ? "" : contentType;
    if (type.contains("application/json")) return json.tree(rawBody);

    if (expectJson) throw new InvalidResponseException(request.method(), request.path(), type);
    return null;
  }
}
