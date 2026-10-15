package in.org.quicko.silo.client;

import java.util.Optional;
import okhttp3.Headers;

/**
 * The header a delete carries its trash receipt's id in (D113), and the reader
 * for it.
 *
 * <p>Absent when the delete was permanent or the instance has the trash off, so
 * a miss reads as "not recoverable", never as an error.
 */
public final class TrashHeader {
  public static final String Name = "X-Silo-Trash-Id";

  private TrashHeader() {}

  /** OkHttp looks header names up case-insensitively. */
  public static Optional<String> read(Headers headers) {
    String value = headers.get(Name);
    return value == null || value.isEmpty() ? Optional.empty() : Optional.of(value);
  }
}
