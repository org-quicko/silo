package in.org.quicko.silo.client.errors;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.media.MediaMapper;
import in.org.quicko.silo.client.transport.JsonCodec;
import java.util.ArrayList;
import java.util.List;

/**
 * Turns a non-2xx response body into the right exception. Reads the wire's
 * {@code code} first and falls back to the HTTP status when the code is missing
 * or unrecognised, so it survives a body that is not JSON at all — an HTML proxy
 * error page, say — without throwing on the way.
 */
public final class ErrorFactory {
  private ErrorFactory() {}

  public static SiloException fromResponseBody(
      int status, String method, String path, String rawBody, JsonCodec json) {
    JsonNode error = errorOf(json.treeOrNull(rawBody));
    if (error == null) {
      String message = rawBody != null && !rawBody.isBlank()
          ? rawBody
          : "request failed with status " + status;
      return byStatus(status, message, method, path);
    }

    String code = error.path("code").asText("");
    String message = error.path("message").asText("");
    JsonNode details = error.get("details");

    return switch (code) {
      case "validation_failed" -> validationFailed(message, method, path, details);
      case "unauthorized" -> new UnauthorizedException(message, method, path);
      case "forbidden" -> new ForbiddenException(message, method, path);
      case "not_found" -> new NotFoundException(message, method, path);
      case "conflict" -> new ConflictException(message, method, path);
      case "media_in_use" -> mediaInUse(message, method, path, details);
      case "media_delete_stalled" -> mediaDeleteStalled(message, method, path, details);
      case "internal" -> new InternalException(message, method, path);
      default -> byStatus(status, message, method, path);
    };
  }

  /**
   * An unrecognised code, or none at all: fall back on the HTTP status, and on
   * {@link SiloException} itself when even the status is not one this client
   * otherwise names a class for.
   */
  private static SiloException byStatus(int status, String message, String method, String path) {
    return switch (status) {
      case 400 -> new ValidationFailedException(message, method, path, List.of());
      case 401 -> new UnauthorizedException(message, method, path);
      case 403 -> new ForbiddenException(message, method, path);
      case 404 -> new NotFoundException(message, method, path);
      case 409 -> new ConflictException(message, method, path);
      default -> new SiloException(status, "unknown", message, method, path);
    };
  }

  private static ValidationFailedException validationFailed(
      String message, String method, String path, JsonNode details) {
    List<ValidationDetail> parsed = new ArrayList<>();
    if (details != null && details.isArray()) {
      for (JsonNode detail : details) {
        parsed.add(new ValidationDetail(detail.path("path").asText(""), detail.path("message").asText("")));
      }
    }
    return new ValidationFailedException(message, method, path, parsed);
  }

  /** This code's {@code details} is an OBJECT, unlike every other code's array. */
  private static MediaInUseException mediaInUse(
      String message, String method, String path, JsonNode details) {
    JsonNode object = details == null || !details.isObject() ? null : details;
    return new MediaInUseException(
        message,
        method,
        path,
        object == null ? 0 : object.path("usage_count").asLong(0),
        object == null ? 0 : object.path("visible_count").asLong(0),
        object != null && object.path("visible_capped").asBoolean(false),
        object == null ? List.of() : MediaMapper.toUsages(object.get("referrers")));
  }

  private static MediaDeleteStalledException mediaDeleteStalled(
      String message, String method, String path, JsonNode details) {
    String remedy = details == null ? "" : details.path("remedy").asText("");
    return new MediaDeleteStalledException(message, method, path, remedy);
  }

  private static JsonNode errorOf(JsonNode body) {
    if (body == null || !body.isObject()) return null;
    JsonNode error = body.get("error");
    return error != null && error.isObject() ? error : null;
  }
}
