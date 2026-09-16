package in.org.quicko.silo.client.errors;

import java.util.List;

/** A {@code 400}: the request was malformed, with one entry per field the validator rejected. */
public class ValidationFailedException extends SiloException {
  private final List<ValidationDetail> details;

  public ValidationFailedException(String message, String method, String path, List<ValidationDetail> details) {
    super(400, "validation_failed", message, method, path);
    this.details = List.copyOf(details);
  }

  /** One entry per rejected field, or empty when the server named none. */
  public List<ValidationDetail> details() {
    return details;
  }
}
