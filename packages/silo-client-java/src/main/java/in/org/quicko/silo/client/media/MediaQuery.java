package in.org.quicko.silo.client.media;

import java.time.Instant;

/**
 * What {@code media.list()} searches on, in client-facing names. {@link Media}
 * translates these onto the wire's {@code q}, {@code ext},
 * {@code modified_after} and {@code modified_before} — the same rule the
 * response mapper follows, applied to a request instead.
 */
public record MediaQuery(
    String text,
    String folder,
    Boolean recursive,
    String type,
    String extension,
    String tag,
    Instant modifiedAfter,
    Instant modifiedBefore,
    Integer limit,
    Integer offset,
    String sort) {

  private static final MediaQuery All =
      new MediaQuery(null, null, null, null, null, null, null, null, null, null, null);

  public static MediaQuery all() {
    return All;
  }

  /** Substring match on the filename, which the wire carries as {@code q}. */
  public MediaQuery text(String value) {
    return new MediaQuery(value, folder, recursive, type, extension, tag, modifiedAfter, modifiedBefore, limit, offset, sort);
  }

  /** Exactly this folder, or every folder beneath it when recursive is set. */
  public MediaQuery folder(String value) {
    return new MediaQuery(text, value, recursive, type, extension, tag, modifiedAfter, modifiedBefore, limit, offset, sort);
  }

  public MediaQuery recursive(boolean value) {
    return new MediaQuery(text, folder, value, type, extension, tag, modifiedAfter, modifiedBefore, limit, offset, sort);
  }

  /** Substring match on the content type, such as "image/" or "pdf". */
  public MediaQuery type(String value) {
    return new MediaQuery(text, folder, recursive, value, extension, tag, modifiedAfter, modifiedBefore, limit, offset, sort);
  }

  /** Exact file extension, without the dot. */
  public MediaQuery extension(String value) {
    return new MediaQuery(text, folder, recursive, type, value, tag, modifiedAfter, modifiedBefore, limit, offset, sort);
  }

  public MediaQuery tag(String value) {
    return new MediaQuery(text, folder, recursive, type, extension, value, modifiedAfter, modifiedBefore, limit, offset, sort);
  }

  /** Inclusive lower bound on {@code updated_at}. */
  public MediaQuery modifiedAfter(Instant value) {
    return new MediaQuery(text, folder, recursive, type, extension, tag, value, modifiedBefore, limit, offset, sort);
  }

  public MediaQuery modifiedBefore(Instant value) {
    return new MediaQuery(text, folder, recursive, type, extension, tag, modifiedAfter, value, limit, offset, sort);
  }

  public MediaQuery limit(int value) {
    return new MediaQuery(text, folder, recursive, type, extension, tag, modifiedAfter, modifiedBefore, value, offset, sort);
  }

  public MediaQuery offset(int value) {
    return new MediaQuery(text, folder, recursive, type, extension, tag, modifiedAfter, modifiedBefore, limit, value, sort);
  }

  /** "-created_at" (the default), "created_at", "filename", "-filename",
   *  "size" or "-size". */
  public MediaQuery sort(String value) {
    return new MediaQuery(text, folder, recursive, type, extension, tag, modifiedAfter, modifiedBefore, limit, offset, value);
  }

  public int limitOrDefault() {
    return limit == null ? 50 : limit;
  }

  public int offsetOrDefault() {
    return offset == null ? 0 : offset;
  }
}
