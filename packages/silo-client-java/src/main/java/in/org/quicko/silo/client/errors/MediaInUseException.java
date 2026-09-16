package in.org.quicko.silo.client.errors;

import in.org.quicko.silo.client.media.MediaUsage;
import java.util.List;

/**
 * A {@code 409} refusing to delete a media asset entries still reference.
 * Distinct from a plain {@link ConflictException} because it carries facts a
 * caller can act on: the true usage count, how much of it this key may see, and
 * the visible referrers themselves.
 */
public class MediaInUseException extends ConflictException {
  private final long usageCount;
  private final long visibleCount;
  private final boolean visibleCapped;
  private final List<MediaUsage> referrers;

  public MediaInUseException(
      String message,
      String method,
      String path,
      long usageCount,
      long visibleCount,
      boolean visibleCapped,
      List<MediaUsage> referrers) {
    super(message, method, path, "media_in_use");
    this.usageCount = usageCount;
    this.visibleCount = visibleCount;
    this.visibleCapped = visibleCapped;
    this.referrers = List.copyOf(referrers);
  }

  /** Every entry that references the asset, readable by this key or not. */
  public long usageCount() {
    return usageCount;
  }

  /** How many of those this key is allowed to see. */
  public long visibleCount() {
    return visibleCount;
  }

  /** True when the server stopped counting before it ran out of referrers. */
  public boolean visibleCapped() {
    return visibleCapped;
  }

  public List<MediaUsage> referrers() {
    return referrers;
  }
}
