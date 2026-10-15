package in.org.quicko.silo.client.trash;

import java.time.Instant;

/**
 * What {@code trash.list()} narrows by, in client-facing names. {@link Trash}
 * translates them onto the wire's {@code env}, {@code deleted_after},
 * {@code deleted_before} and {@code q}. With nothing set, it is everything this
 * key may see, newest first. {@code project}, {@code environment} and
 * {@code collection} match names.
 */
public record TrashQuery(
    TrashKind kind,
    String project,
    String environment,
    String collection,
    Instant deletedAfter,
    Instant deletedBefore,
    String text,
    Integer limit,
    Integer offset) {

  private static final TrashQuery All =
      new TrashQuery(null, null, null, null, null, null, null, null, null);

  public static TrashQuery all() {
    return All;
  }

  public TrashQuery kind(TrashKind value) {
    return new TrashQuery(value, project, environment, collection, deletedAfter, deletedBefore, text, limit, offset);
  }

  public TrashQuery project(String value) {
    return new TrashQuery(kind, value, environment, collection, deletedAfter, deletedBefore, text, limit, offset);
  }

  public TrashQuery environment(String value) {
    return new TrashQuery(kind, project, value, collection, deletedAfter, deletedBefore, text, limit, offset);
  }

  public TrashQuery collection(String value) {
    return new TrashQuery(kind, project, environment, value, deletedAfter, deletedBefore, text, limit, offset);
  }

  public TrashQuery deletedAfter(Instant value) {
    return new TrashQuery(kind, project, environment, collection, value, deletedBefore, text, limit, offset);
  }

  public TrashQuery deletedBefore(Instant value) {
    return new TrashQuery(kind, project, environment, collection, deletedAfter, value, text, limit, offset);
  }

  /** Case-insensitive substring of the subject's name, which the wire carries
   *  as {@code q}. */
  public TrashQuery text(String value) {
    return new TrashQuery(kind, project, environment, collection, deletedAfter, deletedBefore, value, limit, offset);
  }

  public TrashQuery limit(int value) {
    return new TrashQuery(kind, project, environment, collection, deletedAfter, deletedBefore, text, value, offset);
  }

  public TrashQuery offset(int value) {
    return new TrashQuery(kind, project, environment, collection, deletedAfter, deletedBefore, text, limit, value);
  }

  public int limitOrDefault() {
    return limit == null ? 50 : limit;
  }

  public int offsetOrDefault() {
    return offset == null ? 0 : offset;
  }
}
